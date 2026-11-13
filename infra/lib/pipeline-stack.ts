/**
 * PipelineStack — the processing chain (spec 11.4, EF-LEC / EF-RAT / EF-SUF).
 *
 * One Step Functions state machine, seven Lambda tasks, in the exact order the
 * specification gives:
 *
 *   fingerprint → duplicate check → read (Data Automation) → candidates
 *   (frameworks knowledge base) → attachments + sufficiency (model, structured
 *   output) → control states (code only) → indexing (evidence knowledge base)
 *
 * Every task is a Lambda from `src/pipeline/*.ts`; the state machine carries the
 * payload, retries twice with exponential back-off and lands failures in a
 * CloudWatch log group that the observability stack alarms on.
 *
 * A duplicate short-circuits the chain: the second location is recorded on the
 * existing evidence and no model token is spent (EF-COL-05, acceptance R8).
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';
import { EVIDENCE_KB_PREFIX, bedrockPolicyStatements } from './bedrock-stack';
import { resourceName, type HandlerKey, type RegistreConfig } from './config';
import { createHandler, grantBucket } from './handlers';

/** The seven task Lambdas of the chain, keyed by their role. */
export interface PipelineLambdas {
  readonly ingest: lambda.IFunction;
  readonly read: lambda.IFunction;
  readonly candidates: lambda.IFunction;
  readonly attach: lambda.IFunction;
  readonly sufficiency: lambda.IFunction;
  readonly states: lambda.IFunction;
  readonly index: lambda.IFunction;
}

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  readonly table: dynamodb.ITable;
  readonly vaultBucket: s3.IBucket;
  readonly key: kms.IKey;
  readonly frameworksKnowledgeBaseId: string;
  readonly evidenceKnowledgeBaseId: string;
  readonly guardrailId: string;
  readonly dataAutomationProjectArn: string;
}

export class PipelineStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly lambdas: PipelineLambdas;
  /** Log group holding execution history; the observability stack alarms on it. */
  public readonly executionLogs: LogGroup;

  public constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    this.lambdas = this.createLambdas(props);
    this.executionLogs = new LogGroup(this, 'ExecutionLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    this.stateMachine = this.createStateMachine(props, this.lambdas);
    this.createTrigger(props);
  }

  /** Shared environment every task receives; no stack ever repeats these keys. */
  private taskEnvironment(props: PipelineStackProps): Record<string, string> {
    const { config } = props;
    // Names are exactly the ones `src/bootstrap.ts` reads: a Lambda and a
    // laptop then run the same composition root. `REGISTRE_SES_FROM` is left
    // unset on purpose - until a sender identity is verified, reminders are
    // captured instead of sent (docs/OPERATIONS.md).
    return {
      REGISTRE_PROVIDER: 'bedrock',
      REGISTRE_REGION: config.region,
      REGISTRE_TABLE: props.table.tableName,
      REGISTRE_VAULT_BUCKET: props.vaultBucket.bucketName,
      REGISTRE_KB_FRAMEWORKS_ID: props.frameworksKnowledgeBaseId,
      REGISTRE_KB_EVIDENCE_ID: props.evidenceKnowledgeBaseId,
      REGISTRE_KB_EVIDENCE_PREFIX: EVIDENCE_KB_PREFIX,
      REGISTRE_GUARDRAIL_ID: props.guardrailId,
      REGISTRE_BDA_PROJECT_ARN: props.dataAutomationProjectArn,
      REGISTRE_BDA_OUTPUT_URI: `s3://${props.vaultBucket.bucketName}/data-automation/`,
      REGISTRE_CONFIDENCE_THRESHOLD: String(config.confidenceThreshold),
      REGISTRE_REMINDER_LEAD_DAYS: String(config.reminderLeadDays),
      REGISTRE_RETENTION_MONTHS: String(config.retentionMonths),
      REGISTRE_REASONING_MODEL: config.models.reasoning,
      REGISTRE_ANSWER_MODEL: config.models.answer,
      // STANDARD, not FLEX: haiku 4.5 in eu-central-1 refuses the Flex tier
      // ("The provided service tier is not supported for this model"). The
      // reasoner degrades automatically, but paying for a failed call is silly.
      REGISTRE_NIGHTLY_TIER: 'STANDARD'
    };
  }

  /** Builds the seven task Lambdas with least-privilege grants. */
  private createLambdas(props: PipelineStackProps): PipelineLambdas {
    const environment = this.taskEnvironment(props);
    const make = (id: string, key: HandlerKey, memoryMb: number, timeoutMinutes: number): lambda.IFunction => {
      const fn = createHandler(this, id, {
        key,
        memoryMb,
        timeout: Duration.minutes(timeoutMinutes),
        environment,
        policies: bedrockPolicyStatements(props.config)
      });
      props.table.grantReadWriteData(fn);
      props.key.grantDecrypt(fn);
      // The reader writes too: Data Automation puts its result under
      // `data-automation/` with the caller's rights, encrypted by the vault key.
      grantBucket(fn, props.vaultBucket.bucketArn, true);
      // The reader and the indexer write encrypted objects (results, knowledge-base pages).
      if (key === 'read' || key === 'index') props.key.grantEncryptDecrypt(fn);
      return fn;
    };
    return {
      ingest: make('Ingest', 'ingest', 512, 2),
      read: make('Read', 'read', 2048, 15),
      candidates: make('Candidates', 'candidates', 1024, 5),
      attach: make('Attach', 'attach', 1024, 5),
      sufficiency: make('Sufficiency', 'sufficiency', 1024, 5),
      states: make('States', 'states', 512, 2),
      index: make('Index', 'index', 512, 5)
    };
  }

  /** Wraps one Lambda into a Step Functions task with shared retry policy. */
  private task(id: string, fn: lambda.IFunction): tasks.LambdaInvoke {
    const step = new tasks.LambdaInvoke(this, id, {
      lambdaFunction: fn,
      payloadResponseOnly: true,
      retryOnServiceExceptions: true,
      taskTimeout: sfn.Timeout.duration(Duration.minutes(15))
    });
    // A burst of deposits can exceed the account's Lambda concurrency (10 on a
    // new account): a throttled step waits and retries instead of failing the
    // evidence.
    step.addRetry({
      errors: ['Lambda.TooManyRequestsException'],
      interval: Duration.seconds(10),
      backoffRate: 2,
      maxAttempts: 8,
      jitterStrategy: sfn.JitterType.FULL
    });
    return step;
  }

  /** fingerprint → dedupe choice → read → candidates → attach → sufficiency → states → index. */
  private createStateMachine(props: PipelineStackProps, lambdas: PipelineLambdas): sfn.StateMachine {
    const fingerprint = this.task('StepFingerprint', lambdas.ingest);
    const read = this.task('StepRead', lambdas.read);
    const candidates = this.task('StepCandidates', lambdas.candidates);
    const attach = this.task('StepAttach', lambdas.attach);
    const sufficiency = this.task('StepSufficiency', lambdas.sufficiency);
    const states = this.task('StepStates', lambdas.states);
    const index = this.task('StepIndex', lambdas.index);

    const duplicate = new sfn.Succeed(this, 'DuplicateShortCircuit', {
      comment: 'Content already stored: location recorded, no model call (R8)'
    });
    // A task reports a failure as `ok: false` (src/lambda/shared.ts) instead of
    // throwing; without this guard the chain would carry on with an empty payload
    // and the execution would end "succeeded" with nothing read.
    const failed = new sfn.Fail(this, 'StepFailed', { errorPath: '$.error.code', causePath: '$.error.message' });
    const guard = (id: string, next: sfn.IChainable): sfn.Choice =>
      new sfn.Choice(this, `${id}Ok`).when(sfn.Condition.booleanEquals('$.ok', false), failed).otherwise(next);

    const decide = new sfn.Choice(this, 'AlreadyStored')
      .when(sfn.Condition.booleanEquals('$.duplicate', true), duplicate)
      .otherwise(read);

    const chain = fingerprint.next(guard('Fingerprint', decide));
    read.next(guard('Read', candidates));
    candidates.next(guard('Candidates', attach));
    attach.next(guard('Attach', sufficiency));
    sufficiency.next(guard('Sufficiency', states));
    states.next(guard('States', index));
    index.next(guard('Index', new sfn.Succeed(this, 'Indexed')));

    return new sfn.StateMachine(this, 'Pipeline', {
      stateMachineName: resourceName(props.config, 'pipeline'),
      definitionBody: sfn.DefinitionBody.fromChainable(chain),
      stateMachineType: sfn.StateMachineType.STANDARD,
      tracingEnabled: true,
      timeout: Duration.hours(1),
      logs: {
        destination: this.executionLogs,
        level: sfn.LogLevel.ALL,
        includeExecutionData: false
      }
    });
  }

  /** Any new object under `evidence/` starts the chain (EventBridge on S3). */
  private createTrigger(props: PipelineStackProps): void {
    const input = events.RuleTargetInput.fromObject({
      bucket: events.EventField.fromPath('$.detail.bucket.name'),
      key: events.EventField.fromPath('$.detail.object.key'),
      sizeBytes: events.EventField.fromPath('$.detail.object.size'),
      eventTime: events.EventField.fromPath('$.time'),
      source: 'S3'
    });
    new events.Rule(this, 'NewEvidence', {
      ruleName: resourceName(props.config, 'new-evidence'),
      description: 'Start the evidence pipeline when an object lands in the vault',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.vaultBucket.bucketName] },
          object: { key: [{ prefix: 'evidence/' }] }
        }
      },
      targets: [new targets.SfnStateMachine(this.stateMachine, { input })]
    });
  }
}
