/**
 * CollectorsStack — the three collectors of the demo (EF-COL-01, 03, 04).
 *
 * Each collector is an independent Lambda behind its own schedule, writing a
 * dated file into the vault under `evidence/`. Replacing a collector means
 * replacing one function: the pipeline only sees "a new object in the vault".
 *
 *   s3        nightly 01:00  scan a partner document bucket, copy new objects
 *   itsm      nightly 02:00  export incidents/changes/problems for the period
 *   awsreport monthly 03:00  dated AWS state report (e.g. backup coverage)
 *
 * A dead-letter queue catches schedule deliveries that fail after retries, so a
 * silent collector cannot look like "no new evidence" (ENF-OBS-01).
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { resourceName, type HandlerKey, type RegistreConfig } from './config';
import { createHandler, grantBucket } from './handlers';

const SCHEDULE_TZ = 'Europe/Paris';

/** One collector: handler key, schedule expression, memory and description. */
interface CollectorSpec {
  readonly id: string;
  readonly key: HandlerKey;
  readonly cron: string;
  readonly memoryMb: number;
  readonly description: string;
}

const COLLECTORS: readonly CollectorSpec[] = [
  {
    id: 'S3Collector',
    key: 'collectS3',
    cron: 'cron(0 1 * * ? *)',
    memoryMb: 1024,
    description: 'Copy new documents from the partner document bucket (EF-COL-01)'
  },
  {
    id: 'ItsmCollector',
    key: 'collectItsm',
    cron: 'cron(0 2 * * ? *)',
    memoryMb: 1024,
    description: 'Export incidents, changes and problems for the period (EF-COL-03)'
  },
  {
    id: 'AwsReportCollector',
    key: 'collectAwsReport',
    cron: 'cron(0 3 1 * ? *)',
    memoryMb: 1024,
    description: 'Produce a dated AWS state report (EF-COL-04)'
  }
];

export interface CollectorsStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  readonly table: dynamodb.ITable;
  readonly vaultBucket: s3.IBucket;
  readonly key: kms.IKey;
  /** Partner document bucket read by the S3 collector (optional at synth). */
  readonly sourceBucketName: string;
}

export class CollectorsStack extends cdk.Stack {
  /** Every collector function, so the observability stack can alarm on each. */
  public readonly functions: lambda.IFunction[];
  public readonly deadLetterQueue: sqs.Queue;

  public constructor(scope: Construct, id: string, props: CollectorsStackProps) {
    super(scope, id, props);
    this.deadLetterQueue = new sqs.Queue(this, 'CollectorDlq', {
      queueName: resourceName(props.config, 'collectors-dlq'),
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.key as kms.Key,
      enforceSSL: true
    });

    this.functions = COLLECTORS.map((spec) => this.createCollector(props, spec));
    for (const [index, spec] of COLLECTORS.entries()) {
      const fn = this.functions[index];
      if (fn) this.createSchedule(props.config, spec, fn);
    }
    for (const fn of this.functions) {
      new cdk.CfnOutput(this, `${fn.node.id}Name`, { value: fn.functionName });
    }
  }

  /** Shared environment + grants for one collector. */
  private createCollector(props: CollectorsStackProps, spec: CollectorSpec): lambda.IFunction {
    const { config } = props;
    const fn = createHandler(this, spec.id, {
      key: spec.key,
      memoryMb: spec.memoryMb,
      timeout: Duration.minutes(15),
      description: spec.description,
      environment: {
        REGISTRE_PROVIDER: 'bedrock',
        REGISTRE_REGION: config.region,
        REGISTRE_TABLE: props.table.tableName,
        REGISTRE_VAULT_BUCKET: props.vaultBucket.bucketName,
        REGISTRE_SOURCE_BUCKET: props.sourceBucketName,
        REGISTRE_RETENTION_MONTHS: String(config.retentionMonths)
      }
    });
    props.table.grantReadWriteData(fn);
    props.key.grantDecrypt(fn);
    grantBucket(fn, props.vaultBucket.bucketArn, true);
    if (fn.role) {
      fn.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject*', 's3:ListBucket'],
          resources: [`arn:aws:s3:::${props.sourceBucketName}`, `arn:aws:s3:::${props.sourceBucketName}/*`]
        })
      );
    }
    return fn;
  }

  /** Nightly or monthly schedule, with the shared dead-letter queue. */
  private createSchedule(config: RegistreConfig, spec: CollectorSpec, fn: lambda.IFunction): void {
    new scheduler.Schedule(this, `${spec.id}Schedule`, {
      scheduleName: resourceName(config, spec.key.toLowerCase()),
      description: spec.description,
      schedule: scheduler.ScheduleExpression.expression(spec.cron, cdk.TimeZone.of(SCHEDULE_TZ)),
      target: new schedulerTargets.LambdaInvoke(fn, {
        deadLetterQueue: this.deadLetterQueue,
        input: scheduler.ScheduleTargetInput.fromObject({ trigger: 'SCHEDULED', collector: spec.key })
      })
    });
  }
}
