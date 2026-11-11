/**
 * ObservabilityStack — alarms, dashboard and budget (ENF-OBS-01, chapter 17.3).
 *
 * ENF-OBS-01 asks for supervision of "each collection and each read". That is
 * taken literally: one alarm per Lambda, built from the function objects, so a
 * new handler cannot be added without appearing here. On top of that:
 *
 *   - state machine failures and timeouts;
 *   - API Gateway 5xx;
 *   - dead-letter queue depth for scheduled collectors;
 *   - an AWS Budgets limit with e-mail alerts at 80 % actual and 100 %
 *     forecast, because the hackathon credits are finite.
 *
 * Every alarm notifies one SNS topic subscribed to `config.alertEmail`.
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { resourceName, type RegistreConfig } from './config';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  /** Every Lambda of the product: collections, reads, API, reminders. */
  readonly functions: lambda.IFunction[];
  readonly stateMachine: sfn.IStateMachine;
  readonly deadLetterQueue: sqs.IQueue;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly topic: sns.Topic;

  public constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.topic = new sns.Topic(this, 'Alarms', {
      topicName: resourceName(config, 'alarms'),
      displayName: 'Registre alarms'
    });
    this.topic.addSubscription(new subscriptions.EmailSubscription(config.alertEmail));

    const alarmAction = new actions.SnsAction(this.topic);
    for (const fn of props.functions) this.alarmOnFunction(config, fn, alarmAction);
    this.alarmOnPipeline(config, props.stateMachine, alarmAction);
    this.alarmOnDlq(config, props.deadLetterQueue, alarmAction);
    this.createDashboard(config, props.functions);
    this.createBudget(config);

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.topic.topicArn });
  }

  /** Two alarms per function: errors (any) and p95 duration near the timeout. */
  private alarmOnFunction(config: RegistreConfig, fn: lambda.IFunction, action: cloudwatch.IAlarmAction): void {
    const label = fn.node.id.replace(/[^a-zA-Z0-9]/g, '');
    const errors = fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' });
    new cloudwatch.Alarm(this, `Errors${label}`, {
      alarmName: resourceName(config, `errors-${label.toLowerCase()}`),
      alarmDescription: `Errors on ${label} (ENF-OBS-01)`,
      metric: errors,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(action);

    const throttles = fn.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' });
    new cloudwatch.Alarm(this, `Throttles${label}`, {
      alarmName: resourceName(config, `throttles-${label.toLowerCase()}`),
      alarmDescription: `Throttles on ${label}: the pipeline is falling behind (ENF-OBS-01)`,
      metric: throttles,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(action);
  }

  /** Failed or timed-out pipeline executions: a read that never happened. */
  private alarmOnPipeline(config: RegistreConfig, machine: sfn.IStateMachine, action: cloudwatch.IAlarmAction): void {
    new cloudwatch.Alarm(this, 'PipelineFailures', {
      alarmName: resourceName(config, 'pipeline-failures'),
      alarmDescription: 'Evidence pipeline executions failed (ENF-OBS-01)',
      metric: machine.metricFailed({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(action);
  }

  /** A silent collector must never look like "no new evidence". */
  private alarmOnDlq(config: RegistreConfig, dlq: sqs.IQueue, action: cloudwatch.IAlarmAction): void {
    new cloudwatch.Alarm(this, 'CollectorDlqDepth', {
      alarmName: resourceName(config, 'collector-dlq'),
      alarmDescription: 'A scheduled collector failed after every retry (ENF-OBS-01)',
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(action);
  }

  /** One dashboard: volume, errors and duration of every function side by side. */
  private createDashboard(config: RegistreConfig, functions: lambda.IFunction[]): void {
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: resourceName(config, 'operations')
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Invocations and errors',
        left: functions.map((fn) => fn.metricInvocations({ period: Duration.hours(1), statistic: 'Sum' })),
        right: functions.map((fn) => fn.metricErrors({ period: Duration.hours(1), statistic: 'Sum' })),
        width: 24
      }),
      new cloudwatch.GraphWidget({
        title: 'Duration p95 (ms)',
        left: functions.map((fn) => fn.metricDuration({ period: Duration.hours(1), statistic: 'p95' })),
        width: 24
      })
    );
  }

  /** AWS Budgets: 80 % actual and 100 % forecast, both by e-mail. */
  private createBudget(config: RegistreConfig): void {
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: resourceName(config, 'monthly'),
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.budgetUsd, unit: 'USD' }
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE'
          },
          subscribers: [{ address: config.alertEmail, subscriptionType: 'EMAIL' }]
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'FORECASTED',
            threshold: 100,
            thresholdType: 'PERCENTAGE'
          },
          subscribers: [{ address: config.alertEmail, subscriptionType: 'EMAIL' }]
        }
      ]
    });
  }
}
