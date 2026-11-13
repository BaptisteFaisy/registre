/**
 * ApiStack — the portal back end (spec chapter 15, EF-ADM-03).
 *
 * API Gateway HTTP API + one Lambda proxy that routes the sixteen endpoints of
 * chapter 15 (`src/api/lambda.ts`), Cognito for identity, and one JWT authorizer
 * so a missing or expired token never reaches the handler.
 *
 * Roles → Cognito groups: QUALITY_LEAD, CONTROL_OWNER, EXECUTIVE,
 * INTERNAL_AUDITOR, ADMIN. The Lambda maps the group claim to a `Principal` and
 * enforces access levels in code (`src/domain/**`), because "RESTRICTED
 * evidence must not be cited to an unauthorised user" (EF-QR-03) is a business
 * rule, not a route rule.
 *
 * Demo accounts for the judges (EF-ADM-03) are created by the post-deploy
 * script `infra/scripts/create-demo-users.sh`, not by CloudFormation: a user
 * password must never be stored in a template or in the repository.
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';
import { bedrockPolicyStatements } from './bedrock-stack';
import { resourceName, type RegistreConfig } from './config';
import { createHandler, grantBucket } from './handlers';

/** Cognito groups, one per role of chapter 6. */
const ROLE_GROUPS = ['QUALITY_LEAD', 'CONTROL_OWNER', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'ADMIN'] as const;

/**
 * The routes the gateway serves, read from the manifest the application
 * generates (`infra/routes.json`, produced by `tools/quality/exportRoutes.ts`).
 *
 * One source of truth: the gateway can never serve a path the application does
 * not implement, and `test/infra/routes.test.ts` fails when the manifest drifts.
 */
interface RouteManifest {
  readonly routes: ReadonlyArray<{
    readonly path: string;
    readonly methods: readonly string[];
    readonly public: boolean;
  }>;
}

const ROUTES_MANIFEST = require('../routes.json') as RouteManifest;

export interface ApiStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  readonly table: dynamodb.ITable;
  readonly vaultBucket: s3.IBucket;
  readonly key: kms.IKey;
  readonly stateMachine: sfn.IStateMachine;
  readonly evidenceKnowledgeBaseId: string;
  readonly frameworksKnowledgeBaseId: string;
  readonly guardrailId: string;
  /** Asymmetric key that signs audit-pack manifests. */
  readonly signingKey: kms.IKey;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigwv2.HttpApi;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly handler: lambda.IFunction;

  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = this.createUserPool(config);
    this.userPoolClient = this.createUserPoolClient(config, this.userPool);
    this.handler = this.createHandlerLambda(props);
    this.api = this.createApi(config, this.handler, this.userPool, this.userPoolClient);

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'DemoPasswordHint', {
      value: 'Set with infra/scripts/create-demo-users.sh (never stored in the repository)'
    });
  }

  /** Cognito user pool: e-mail sign-in, one group per role, no self-signup. */
  private createUserPool(config: RegistreConfig): cognito.UserPool {
    const pool = new cognito.UserPool(this, 'Users', {
      userPoolName: resourceName(config, 'users'),
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: { minLength: 12, requireDigits: true, requireSymbols: true, requireUppercase: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    for (const group of ROLE_GROUPS) {
      new cognito.CfnUserPoolGroup(this, `Group${group}`, {
        userPoolId: pool.userPoolId,
        groupName: group,
        description: `Registre role ${group}`
      });
    }
    return pool;
  }

  /** Public SPA client: no secret, short access token, refresh for a demo day. */
  private createUserPoolClient(config: RegistreConfig, pool: cognito.UserPool): cognito.UserPoolClient {
    return new cognito.UserPoolClient(this, 'PortalClient', {
      userPool: pool,
      userPoolClientName: resourceName(config, 'portal-client'),
      generateSecret: false,
      authFlows: { userPassword: true, userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
      preventUserExistenceErrors: true
    });
  }

  /** The single proxy Lambda; every route of chapter 15 lands in it. */
  private createHandlerLambda(props: ApiStackProps): lambda.IFunction {
    const { config } = props;
    const fn = createHandler(this, 'Api', {
      key: 'api',
      memoryMb: 1024,
      timeout: Duration.seconds(60),
      environment: {
        REGISTRE_PROVIDER: 'bedrock',
        REGISTRE_REGION: config.region,
        REGISTRE_TABLE: props.table.tableName,
        REGISTRE_VAULT_BUCKET: props.vaultBucket.bucketName,
        REGISTRE_KB_EVIDENCE_ID: props.evidenceKnowledgeBaseId,
        REGISTRE_KB_FRAMEWORKS_ID: props.frameworksKnowledgeBaseId,
        REGISTRE_GUARDRAIL_ID: props.guardrailId,
        REGISTRE_CONFIDENCE_THRESHOLD: String(config.confidenceThreshold),
        REGISTRE_RETENTION_MONTHS: String(config.retentionMonths),
        REGISTRE_ANSWER_MODEL: config.models.answer,
        REGISTRE_REASONING_MODEL: config.models.reasoning,
        REGISTRE_NIGHTLY_TIER: 'STANDARD',
        STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
        USER_POOL_ID: this.userPool.userPoolId,
        // The session route signs in with Cognito on AWS (src/api/cognitoSession.ts).
        REGISTRE_COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
        // Pack signing goes through KMS in production; the local Ed25519 signer
        // is what the offline demo and the tests use.
        REGISTRE_SIGNER: 'kms',
        REGISTRE_SIGNING_KEY_ARN: props.signingKey.keyArn
      },
      policies: bedrockPolicyStatements(config)
    });
    props.table.grantReadWriteData(fn);
    props.key.grantDecrypt(fn);
    props.signingKey.grant(fn, 'kms:Sign', 'kms:GetPublicKey');
    grantBucket(fn, props.vaultBucket.bucketArn, true);
    props.stateMachine.grantStartExecution(fn);
    return fn;
  }

  /** HTTP API with a JWT authorizer on every route (default-deny posture). */
  private createApi(
    config: RegistreConfig,
    handler: lambda.IFunction,
    pool: cognito.UserPool,
    client: cognito.UserPoolClient
  ): apigwv2.HttpApi {
    const api = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: resourceName(config, 'api'),
      description: 'Registre portal API (chapter 15)',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1)
      }
    });
    const authorizer = new authorizers.HttpJwtAuthorizer('Cognito', pool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId]
    });
    const integration = new integrations.HttpLambdaIntegration('ApiIntegration', handler, {
      payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0
    });
    for (const route of ROUTES_MANIFEST.routes) {
      for (const method of route.methods) {
        // Public routes (health, OpenAPI document, session, public share
        // verification) carry no authorizer: they are what a judge or a browser
        // reaches before any credential exists.
        api.addRoutes({
          path: route.path,
          methods: [method as apigwv2.HttpMethod],
          integration,
          ...(route.public ? {} : { authorizer })
        });
      }
    }
    return api;
  }
}
