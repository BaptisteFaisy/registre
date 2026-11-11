#!/usr/bin/env node
/**
 * Registre — CDK application entry point.
 *
 * Nine stacks, one region, one account (ENF-DATA-01). Stacks are wired in
 * dependency order; every shared value (KMS key, bucket, table, knowledge base
 * ids) is passed as a typed property, never as a string literal.
 *
 * Region and account come from the environment, which is how the CDK CLI
 * resolves a profile:
 *   CDK_DEFAULT_REGION, CDK_DEFAULT_ACCOUNT
 * Overridable for tests and for a second partner account:
 *   REGISTRE_REGION, AWS_ACCOUNT_ID
 */

import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { BedrockStack } from '../lib/bedrock-stack';
import { CollectorsStack } from '../lib/collectors-stack';
import { loadConfig, PLACEHOLDER_ACCOUNT, type RegistreConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { NotifyStack } from '../lib/notify-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { PortalStack } from '../lib/portal-stack';
import { VaultStack } from '../lib/vault-stack';

/** Concrete environment, required for cross-stack references. */
function environmentOf(config: RegistreConfig): cdk.Environment {
  return { account: config.account, region: config.region };
}

/** Applies the tags every AWS cost report and resource explorer view needs. */
function tag(app: cdk.App, cfg: RegistreConfig): void {
  cdk.Tags.of(app).add('project', 'registre');
  cdk.Tags.of(app).add('component', 'audit-evidence-registry');
  cdk.Tags.of(app).add('data-residency', 'eu');
  cdk.Tags.of(app).add('retention-months', String(cfg.retentionMonths));
}

/** Vault, state store and Bedrock: the three stacks everything else depends on. */
function buildFoundation(app: cdk.App, cfg: RegistreConfig, env: cdk.Environment) {
  const vault = new VaultStack(app, 'Registre-Vault', {
    env,
    config: cfg,
    description: 'Evidence vault: versioned S3, Object Lock (strict retention mode), customer-managed KMS'
  });
  const data = new DataStack(app, 'Registre-Data', {
    env,
    config: cfg,
    key: vault.key,
    description: 'Single DynamoDB table: frameworks, controls, evidence, attachments, states'
  });
  const bedrock = new BedrockStack(app, 'Registre-Bedrock', {
    env,
    config: cfg,
    key: vault.key,
    vaultBucket: vault.bucket,
    description: 'Bedrock: two managed knowledge bases, guardrail, data automation project'
  });
  return { vault, data, bedrock };
}

/** Processing and serving: the pipeline chain and the portal API. */
function buildProcessing(
  app: cdk.App,
  cfg: RegistreConfig,
  env: cdk.Environment,
  base: ReturnType<typeof buildFoundation>
) {
  const pipeline = new PipelineStack(app, 'Registre-Pipeline', {
    env,
    config: cfg,
    table: base.data.table,
    vaultBucket: base.vault.bucket,
    key: base.vault.key,
    frameworksKnowledgeBaseId: base.bedrock.frameworksKnowledgeBaseId,
    evidenceKnowledgeBaseId: base.bedrock.evidenceKnowledgeBaseId,
    guardrailId: base.bedrock.guardrailId,
    dataAutomationProjectArn: base.bedrock.dataAutomationProjectArn,
    description: 'Step Functions chain: fingerprint, read, attach, sufficiency, states, index'
  });
  const api = new ApiStack(app, 'Registre-Api', {
    env,
    config: cfg,
    table: base.data.table,
    vaultBucket: base.vault.bucket,
    key: base.vault.key,
    stateMachine: pipeline.stateMachine,
    evidenceKnowledgeBaseId: base.bedrock.evidenceKnowledgeBaseId,
    guardrailId: base.bedrock.guardrailId,
    description: 'HTTP API, Cognito, the sixteen endpoints of chapter 15'
  });
  return { pipeline, api };
}

/** Delivery and operations: portal hosting, reminders, collectors, observability. */
function buildDelivery(
  app: cdk.App,
  cfg: RegistreConfig,
  env: cdk.Environment,
  base: ReturnType<typeof buildFoundation>,
  served: ReturnType<typeof buildProcessing>
) {
  const portal = new PortalStack(app, 'Registre-Portal', {
    env,
    config: cfg,
    apiUrl: served.api.api.apiEndpoint,
    description: 'CloudFront + S3 portal with origin access control'
  });
  const notify = new NotifyStack(app, 'Registre-Notify', {
    env,
    config: cfg,
    table: base.data.table,
    key: base.vault.key,
    description: 'SES reminders and weekly digest'
  });
  const collectors = new CollectorsStack(app, 'Registre-Collectors', {
    env,
    config: cfg,
    table: base.data.table,
    vaultBucket: base.vault.bucket,
    key: base.vault.key,
    sourceBucketName: cfg.sourceBucketName,
    description: 'EventBridge Scheduler + collector Lambdas'
  });
  const observability = new ObservabilityStack(app, 'Registre-Observability', {
    env,
    config: cfg,
    functions: [
      ...Object.values(served.pipeline.lambdas),
      served.api.handler,
      notify.reminders,
      ...collectors.functions
    ],
    stateMachine: served.pipeline.stateMachine,
    deadLetterQueue: collectors.deadLetterQueue,
    description: 'Alarms on every collection and every read, dashboard, monthly budget'
  });
  return { portal, notify, collectors, observability };
}

/** Builds the nine stacks and returns them, so `main` can report on them. */
function build(app: cdk.App, cfg: RegistreConfig) {
  const env = environmentOf(cfg);
  const foundation = buildFoundation(app, cfg, env);
  const served = buildProcessing(app, cfg, env, foundation);
  return { ...foundation, ...served, ...buildDelivery(app, cfg, env, foundation, served) };
}

const config = loadConfig();
const app = new cdk.App();
const stacks = build(app, config);
tag(app, config);

if (config.account === PLACEHOLDER_ACCOUNT) {
  console.warn(
    `[registre] CDK_DEFAULT_ACCOUNT is unset: using placeholder ${PLACEHOLDER_ACCOUNT} for offline synth. ` +
      'Run `cdk deploy` with a real AWS profile.'
  );
}

console.log(
  `[registre] ${Object.keys(stacks).length} stacks, region ${config.region}, retention ${config.retentionMonths} months`
);
