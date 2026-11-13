/**
 * BedrockStack — every Amazon Bedrock resource of the product (spec 11.3).
 *
 * Two MANAGED knowledge bases (Bedrock owns ingestion, chunking, storage and
 * search), one Guardrail, one Data Automation project, and the two IAM roles
 * that let the pipeline talk to Bedrock and nothing else.
 *
 * POINTS TO CONFIRM BEFORE A REAL DEPLOYMENT (chapter 24, items 4, 6, 7, 8):
 *  - Managed knowledge bases and Data Automation are not available in every EU
 *    region. `eu-central-1` is the default; if the pair is unavailable there,
 *    switch `REGISTRE_REGION` to `eu-central-1` or `eu-west-1` (both stay in
 *    the EU, so ENF-DATA-01 holds) and re-synth.
 *  - `embeddingModelType: MANAGED` lets Bedrock choose the embedding model. If
 *    the chosen model must be pinned, set `embeddingModelArn` instead.
 *  - Metadata filtering on the evidence knowledge base (needed for
 *    `EvidenceRetriever.search({ allowedLevels })`) must be checked against the
 *    managed knowledge base documentation; the fallback is a post-filter in
 *    `src/ai/**`, which is what the offline mock already does.
 *  - The custom field plan of Annex B is attached to a Data Automation project
 *    through a blueprint (`AWS::Bedrock::Blueprint`). Its schema is generated
 *    from `src/ai/prompts/readerBlueprint.ts` and committed under
 *    `infra/blueprints/`; the stack creates it and attaches it to the project.
 *  - Guardrail PII entity coverage and contextual-grounding thresholds are
 *    documented per language; French documents may need `FR` added to the
 *    PII entity list.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { bucketName, resourceName, supportsDataAutomation, type RegistreConfig } from './config';

/** PII entities anonymised by the guardrail (ENF-CONF-02). */
const PII_ENTITIES = ['NAME', 'EMAIL', 'PHONE', 'ADDRESS', 'AGE', 'USERNAME', 'PASSWORD', 'IP_ADDRESS'] as const;

/**
 * Bedrock permissions shared by every Lambda that calls a model, a knowledge
 * base, a guardrail or Data Automation. Exported so the pipeline, API and
 * collector stacks reuse one statement instead of duplicating the ARNs.
 */
export function bedrockPolicyStatements(config: RegistreConfig): iam.PolicyStatement[] {
  return [
    new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Converse',
        'bedrock:ApplyGuardrail',
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
        // The feed finds the data source of a knowledge base before syncing it.
        'bedrock:ListDataSources',
        'bedrock:InvokeDataAutomationAsync',
        'bedrock:GetDataAutomationStatus'
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${config.account}:knowledge-base/*`,
        `arn:aws:bedrock:${config.region}:${config.account}:guardrail/*`,
        `arn:aws:bedrock:${config.region}:${config.account}:data-automation-project/*`,
        // Data Automation runs through the geography's cross-region profile
        // (eu.data-automation-v1), and its status is read per invocation.
        `arn:aws:bedrock:*:${config.account}:data-automation-profile/*`,
        `arn:aws:bedrock:${config.region}:${config.account}:data-automation-invocation/*`,
        `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/*`,
        `arn:aws:bedrock:*::foundation-model/*`
      ]
    })
  ];
}

/** Vault prefix the evidence knowledge base indexes (pages + metadata sidecars). */
export const EVIDENCE_KB_PREFIX = 'kb-evidence/';

export interface BedrockStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  readonly key: kms.IKey;
  /** Vault bucket: the evidence knowledge base indexes its `evidence/` prefix. */
  readonly vaultBucket: s3.IBucket;
}

export class BedrockStack extends cdk.Stack {
  /** Bucket holding the partner's imported framework text (EF-REF-03). */
  public readonly frameworksBucket: s3.Bucket;
  public readonly frameworksKnowledgeBaseId: string;
  public readonly evidenceKnowledgeBaseId: string;
  public readonly guardrailId: string;
  public readonly guardrailArn: string;
  public readonly dataAutomationProjectArn: string;
  /** Role assumed by pipeline Lambdas to call Bedrock models and knowledge bases. */
  public readonly inferenceRole: iam.Role;

  public constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);
    const { config, key, vaultBucket } = props;

    this.frameworksBucket = this.createFrameworksBucket(config, key);

    const kbRole = this.createKnowledgeBaseRole(config, key, vaultBucket);
    this.frameworksKnowledgeBaseId = this.createKnowledgeBase(
      'FrameworksKb',
      resourceName(config, 'kb-frameworks'),
      'Controls of every imported framework, one chunk per control',
      kbRole
    );
    this.evidenceKnowledgeBaseId = this.createKnowledgeBase(
      'EvidenceKb',
      resourceName(config, 'kb-evidence'),
      'Evidence text, chunked, with access level as metadata',
      kbRole
    );
    this.createDataSource('FrameworksSource', this.frameworksKnowledgeBaseId, this.frameworksBucket, ['controls/'], kbRole, config);
    // The pages of read evidence with their metadata (`src/ai/bedrock/knowledgeSync.ts`),
    // not the raw uploads: retrieval filters on `accessLevel`, which only the sidecars carry.
    this.createDataSource('EvidenceSource', this.evidenceKnowledgeBaseId, vaultBucket, [EVIDENCE_KB_PREFIX], kbRole, config);

    const guardrail = this.createGuardrail(config, key);
    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailArn = guardrail.attrGuardrailArn;

    this.dataAutomationProjectArn = this.createDataAutomationProject(config, key);
    this.inferenceRole = this.createInferenceRole(config, vaultBucket, key);

    new cdk.CfnOutput(this, 'FrameworksKnowledgeBaseId', { value: this.frameworksKnowledgeBaseId });
    new cdk.CfnOutput(this, 'EvidenceKnowledgeBaseId', { value: this.evidenceKnowledgeBaseId });
    new cdk.CfnOutput(this, 'GuardrailId', { value: this.guardrailId });
    new cdk.CfnOutput(this, 'GuardrailArn', { value: this.guardrailArn });
    new cdk.CfnOutput(this, 'DataAutomationProjectArn', { value: this.dataAutomationProjectArn });
    new cdk.CfnOutput(this, 'InferenceRoleArn', { value: this.inferenceRole.roleArn });
  }

  /** Private, versioned, KMS-encrypted bucket for imported framework text. */
  private createFrameworksBucket(config: RegistreConfig, key: kms.IKey): s3.Bucket {
    return new s3.Bucket(this, 'Frameworks', {
      bucketName: bucketName(config, 'frameworks'),
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: 'expire-noncurrent', enabled: true, noncurrentVersionExpiration: Duration.days(365) }]
    });
  }

  /** Role Bedrock assumes to read the sources and write embeddings. */
  private createKnowledgeBaseRole(config: RegistreConfig, key: kms.IKey, vaultBucket: s3.IBucket): iam.Role {
    const role = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: resourceName(config, 'bedrock-kb'),
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Bedrock knowledge bases - read sources, write embeddings'
    });
    key.grantDecrypt(role);
    vaultBucket.grantRead(role, 'evidence/*');
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${config.region}::foundation-model/*`,
          `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/*`
        ]
      })
    );
    return role;
  }

  /** One MANAGED knowledge base (Bedrock owns the vector store). */
  private createKnowledgeBase(id: string, name: string, description: string, role: iam.Role): string {
    const kb = new bedrock.CfnKnowledgeBase(this, id, {
      name,
      description,
      roleArn: role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'MANAGED',
        managedKnowledgeBaseConfiguration: { embeddingModelType: 'MANAGED' }
      }
    });
    kb.node.addDependency(role);
    return kb.attrKnowledgeBaseId;
  }

  /**
   * S3 connector of a MANAGED knowledge base; ingestion is started by the
   * pipeline, never on a schedule.
   *
   * A managed knowledge base refuses the self-managed `S3` data source type
   * ("Unsupported data source type for MANAGED knowledge base type", seen on a
   * real deploy in eu-central-1). The managed form is the S3 **connector**,
   * which takes a bucket name plus the owner account, and puts the prefixes
   * under `filterConfiguration.inclusionPrefixes`.
   */
  private createDataSource(
    id: string,
    knowledgeBaseId: string,
    bucket: s3.IBucket,
    prefixes: string[],
    role: iam.Role,
    config: RegistreConfig
  ): void {
    for (const prefix of prefixes) bucket.grantRead(role, `${prefix}*`);
    const source = new bedrock.CfnDataSource(this, id, {
      knowledgeBaseId,
      name: id.toLowerCase(),
      dataDeletionPolicy: 'RETAIN',
      dataSourceConfiguration: {
        type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        managedKnowledgeBaseConnectorConfiguration: {
          connectorParameters: {
            type: 'S3',
            version: '1',
            connectionConfiguration: {
              bucketName: bucket.bucketName,
              bucketOwnerAccountId: config.account
            },
            filterConfiguration: { inclusionPrefixes: prefixes }
          },
          // Kept off for the demonstration so `cdk destroy` stays simple;
          // docs/OPERATIONS.md tells a production deploy to turn it on.
          deletionProtectionConfiguration: { deletionProtectionStatus: 'DISABLED' }
        }
      }
    });
    source.node.addDependency(role);
  }

  /** PII anonymisation + contextual grounding (ENF-CONF-02, ENF-IA-02). */
  private createGuardrail(config: RegistreConfig, key: kms.IKey): bedrock.CfnGuardrail {
    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: resourceName(config, 'guardrail'),
      description: 'Registre - redact personal data, refuse ungrounded answers',
      kmsKeyArn: key.keyArn,
      blockedInputMessaging: 'This request cannot be processed by Registre.',
      blockedOutputsMessaging: 'No evidence answers this question.',
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: PII_ENTITIES.map((type) => ({
          type,
          action: 'ANONYMIZE',
          inputAction: 'ANONYMIZE',
          inputEnabled: true,
          outputAction: 'ANONYMIZE',
          outputEnabled: true
        }))
      },
      contextualGroundingPolicyConfig: {
        filtersConfig: [
          { type: 'GROUNDING', threshold: 0.75, action: 'BLOCK', enabled: true },
          { type: 'RELEVANCE', threshold: 0.5, action: 'BLOCK', enabled: true }
        ]
      }
    });
    // A version must exist before the runtime can reference the guardrail.
    const version = new bedrock.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: 'Initial version created by the stack'
    });
    version.addResourceDependency(guardrail);
    return guardrail;
  }

  /**
   * Data Automation project: documents, images and tables are read with the
   * standard output; the Annex B field plan is attached through a blueprint
   * (see the header comment). Kept as an L1 construct because no L2 exists.
   */
  private createDataAutomationProject(config: RegistreConfig, key: kms.IKey): string {
    if (!config.dataAutomation) {
      cdk.Annotations.of(this).addWarning(
        'REGISTRE_DATA_AUTOMATION=off: no Data Automation project. The reader must fall back to a multimodal model.'
      );
      return '';
    }
    if (!supportsDataAutomation(config.region)) {
      cdk.Annotations.of(this).addWarning(
        `Region ${config.region} has no AWS::Bedrock::DataAutomationProject. ` +
          'Deploy in eu-central-1 or eu-west-1, or set REGISTRE_DATA_AUTOMATION=off to use the multimodal fallback.'
      );
    }
    const blueprint = this.createEvidenceBlueprint(config);
    const project = new bedrock.CfnDataAutomationProject(this, 'ReaderProject', {
      projectName: resourceName(config, 'reader'),
      projectDescription: 'Registre evidence reader - Annex B field extraction',
      projectType: 'ASYNC',
      kmsKeyId: key.keyArn,
      standardOutputConfiguration: {
        document: {
          extraction: {
            boundingBox: { state: 'ENABLED' },
            granularity: { types: ['DOCUMENT', 'PAGE', 'ELEMENT'] }
          },
          generativeField: { state: 'ENABLED' },
          outputFormat: { textFormat: { types: ['PLAIN_TEXT'] }, additionalFileFormat: { state: 'DISABLED' } }
        },
        image: {
          // An ENABLED category must carry at least one type, or Bedrock refuses
          // the project (observed on a real deploy in eu-central-1:
          // "At least 1 Image Extraction Category Type should be present").
          // TEXT_DETECTION is what a screenshot of a dashboard needs (EF-LEC-02).
          extraction: {
            category: { state: 'ENABLED', types: ['TEXT_DETECTION'] },
            boundingBox: { state: 'ENABLED' }
          },
          generativeField: { state: 'ENABLED', types: ['IMAGE_SUMMARY'] }
        }
      },
      // Screenshots are evidence pages, read with the same Annex B document
      // blueprint: routed to the image modality, Bedrock refused them on a real
      // run ("Image format is invalid or not supported").
      overrideConfiguration: { modalityRouting: { png: 'DOCUMENT', jpeg: 'DOCUMENT' } },
      customOutputConfiguration: { blueprints: [{ blueprintArn: blueprint.attrBlueprintArn, blueprintStage: 'LIVE' }] }
    });
    return project.attrProjectArn;
  }

  /**
   * The Annex B field plan, generated from `src/ai/prompts/readerBlueprint.ts`
   * (a test keeps the committed schema equal to the plan). Without it, Data
   * Automation returns the text only and no evidence carries a date or an author.
   */
  private createEvidenceBlueprint(config: RegistreConfig): bedrock.CfnBlueprint {
    return new bedrock.CfnBlueprint(this, 'EvidenceBlueprint', {
      blueprintName: resourceName(config, 'evidence'),
      type: 'DOCUMENT',
      schema: JSON.parse(readFileSync(join(__dirname, '..', 'blueprints', 'evidence.schema.json'), 'utf8')) as unknown
    });
  }

  /** Least-privilege role used by every pipeline and API Lambda that calls Bedrock. */
  private createInferenceRole(config: RegistreConfig, vaultBucket: s3.IBucket, key: kms.IKey): iam.Role {
    const role = new iam.Role(this, 'InferenceRole', {
      roleName: resourceName(config, 'inference'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Registre pipeline - invoke Bedrock models, retrieve passages, apply guardrails'
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    key.grantDecrypt(role);
    vaultBucket.grantRead(role, 'evidence/*');
    role.addToPolicy(bedrockPolicyStatements(config)[0] as iam.PolicyStatement);
    return role;
  }
}
