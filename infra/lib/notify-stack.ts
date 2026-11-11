/**
 * NotifyStack — SES reminders (EF-REL-01..03).
 *
 * One verified SES identity, one Lambda that builds reminders from the state
 * store, two schedules:
 *   - daily 06:00 Europe/Paris: evidence expiring in `reminderLeadDays`, and
 *     controls with no evidence at all (EF-REL-01, EF-REL-02);
 *   - Monday 07:00: the weekly digest to the quality lead (EF-REL-03).
 *
 * The same handler serves both payloads, so the reminder text and the "what is
 * missing" list live in one place.
 *
 * POINTS TO CONFIRM BEFORE A REAL DEPLOYMENT: SES starts in the sandbox, so
 * every recipient must be verified until production access is granted; the
 * domain identity below also needs its DKIM records published in Route 53 or
 * at the registrar. Both are one-time manual steps (see infra/README.md).
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import { resourceName, type RegistreConfig } from './config';
import { createHandler } from './handlers';

/** Local time used by both schedules: the MSP works in Europe/Paris. */
const SCHEDULE_TZ = 'Europe/Paris';

export interface NotifyStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  readonly table: dynamodb.ITable;
  readonly key: kms.IKey;
}

export class NotifyStack extends cdk.Stack {
  public readonly identity: ses.EmailIdentity;
  public readonly reminders: lambda.IFunction;

  public constructor(scope: Construct, id: string, props: NotifyStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.identity = new ses.EmailIdentity(this, 'Domain', {
      identity: ses.Identity.domain(config.mailDomain),
      dkimSigning: true,
      feedbackForwarding: true
    });

    this.reminders = this.createReminderLambda(props);
    this.identity.grantSendEmail(this.reminders.role as iam.IRole);
    this.createSchedules(config, this.reminders);

    new cdk.CfnOutput(this, 'SenderDomain', { value: config.mailDomain });
    new cdk.CfnOutput(this, 'ReminderFunctionName', { value: this.reminders.functionName });
  }

  /** The reminder handler; reads the state store, writes reminders, sends e-mail. */
  private createReminderLambda(props: NotifyStackProps): lambda.IFunction {
    const { config } = props;
    const fn = createHandler(this, 'Reminders', {
      key: 'reminders',
      memoryMb: 512,
      timeout: Duration.minutes(5),
      environment: {
        REGISTRE_REGION: config.region,
        TABLE_NAME: props.table.tableName,
        MAIL_FROM: `registre@${config.mailDomain}`,
        REMINDER_LEAD_DAYS: String(config.reminderLeadDays),
        ALERT_EMAIL: config.alertEmail
      }
    });
    props.table.grantReadWriteData(fn);
    props.key.grantDecrypt(fn);
    return fn;
  }

  /** Daily expiry pass + weekly digest, both on the same handler. */
  private createSchedules(config: RegistreConfig, fn: lambda.IFunction): void {
    new scheduler.Schedule(this, 'DailyReminders', {
      scheduleName: resourceName(config, 'reminders-daily'),
      description: 'Evidence expiring soon and controls with no evidence (EF-REL-01, EF-REL-02)',
      schedule: scheduler.ScheduleExpression.expression('cron(0 6 * * ? *)', cdk.TimeZone.of(SCHEDULE_TZ)),
      target: new schedulerTargets.LambdaInvoke(fn, {
        input: scheduler.ScheduleTargetInput.fromObject({ kind: 'REMINDER', trigger: 'DAILY' })
      })
    });

    new scheduler.Schedule(this, 'WeeklyDigest', {
      scheduleName: resourceName(config, 'digest-weekly'),
      description: 'Weekly readiness point for the quality lead (EF-REL-03)',
      schedule: scheduler.ScheduleExpression.expression('cron(0 7 ? * MON *)', cdk.TimeZone.of(SCHEDULE_TZ)),
      target: new schedulerTargets.LambdaInvoke(fn, {
        input: scheduler.ScheduleTargetInput.fromObject({ kind: 'WEEKLY_DIGEST', trigger: 'WEEKLY' })
      })
    });
  }
}
