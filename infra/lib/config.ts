/**
 * Registre — shared infrastructure parameters.
 *
 * Single source of truth for names, retention, thresholds, region and the
 * mapping between a logical step and the TypeScript file that implements it.
 * Read by `bin/registre.ts` and by every stack; nothing else hard-codes a name.
 *
 * ENF-DATA-01: everything is deployed in ONE European region. The region is
 * validated at synth time — a non-EU region is a hard failure, not a warning.
 */

/** Regions inside the EU where Bedrock is available (see infra/README.md). */
export const EU_REGIONS = [
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2'
] as const;

/**
 * EU regions where CloudFormation knows `AWS::Bedrock::DataAutomationProject`
 * (verified with `cdk synth` against the resource spec shipped in aws-cdk-lib
 * 2.276: eu-central-1 and eu-west-1 pass, while eu-west-3 (Paris), eu-north-1
 * and eu-south-1 raise F3006). Re-verify before a real deployment.
 */
export const DATA_AUTOMATION_REGIONS = ['eu-central-1', 'eu-west-1'] as const;

/** Fallback region (Paris). Overridden by `CDK_DEFAULT_REGION` / `REGISTRE_REGION`. */
export const DEFAULT_REGION = 'eu-central-1';

/** Placeholder account used when `cdk synth` runs without AWS credentials. */
export const PLACEHOLDER_ACCOUNT = '111111111111';

/**
 * Logical step → handler file, relative to the repository root.
 *
 * Every entry but `api` points at an adapter of `src/lambda/`: one file, one
 * exported `handler`, one step of the specification. `infra/lib/handlers.ts`
 * checks that each file really exports a `handler` before bundling it, and
 * falls back to a 501 stub only when it does not.
 */
export const HANDLERS = {
  api: 'src/api/lambda.ts',
  ingest: 'src/lambda/ingest.ts',
  read: 'src/lambda/read.ts',
  candidates: 'src/lambda/candidates.ts',
  attach: 'src/lambda/attach.ts',
  sufficiency: 'src/lambda/sufficiency.ts',
  states: 'src/lambda/states.ts',
  index: 'src/lambda/indexEvidence.ts',
  reminders: 'src/lambda/reminders.ts',
  collectS3: 'src/lambda/collectS3.ts',
  collectItsm: 'src/lambda/collectItsm.ts',
  collectAwsReport: 'src/lambda/collectAwsReport.ts'
} as const;

export type HandlerKey = keyof typeof HANDLERS;

/** Bedrock model identifiers; every one of them is overridable by environment. */
export interface ModelIds {
  /** Structured-output model used for attachments and sufficiency. */
  readonly reasoning: string;
  /** Model composing grounded answers for the ask endpoint. */
  readonly answer: string;
}

/** Every parameter a stack may need. Plain values only (no CDK tokens). */
export interface RegistreConfig {
  readonly appName: string;
  readonly region: string;
  readonly account: string;
  /** Evidence retention in months (spec: audit cycle + one year, adjustable). */
  readonly retentionMonths: number;
  readonly retentionDays: number;
  /** Attachments at or above this confidence are applied without review. */
  readonly confidenceThreshold: number;
  /** Days before expiry at which an owner is reminded. */
  readonly reminderLeadDays: number;
  readonly defaultPeriodicity: string;
  /** Monthly AWS Budgets limit, in USD (spec chapter 17.3). */
  readonly budgetUsd: number;
  readonly alertEmail: string;
  readonly mailDomain: string;
  /** Partner document bucket scanned by the S3 collector (read-only). */
  readonly sourceBucketName: string;
  /**
   * Create the Bedrock Data Automation project. Turned off with
   * `REGISTRE_DATA_AUTOMATION=off`, which is the documented fallback when the
   * region has no Data Automation: the reader then uses a multimodal model.
   */
  readonly dataAutomation: boolean;
  readonly models: ModelIds;
}

/**
 * Returns the deployment region.
 *
 * Precedence: `REGISTRE_REGION` (explicit, must be EU or synth fails) →
 * `CDK_DEFAULT_REGION` (the AWS profile's region, used only when it is inside
 * the EU) → `eu-central-1`. ENF-DATA-01 makes the EU constraint absolute, so a
 * profile pointing at `us-east-1` never silently produces an American stack:
 * it falls back to Paris with a loud warning.
 */
export function resolveRegion(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.REGISTRE_REGION;
  if (explicit !== undefined) {
    if (!isEuRegion(explicit)) {
      throw new Error(`ENF-DATA-01: REGISTRE_REGION="${explicit}" is outside the EU. Allowed: ${EU_REGIONS.join(', ')}.`);
    }
    return explicit;
  }
  const fromProfile = env.CDK_DEFAULT_REGION;
  if (fromProfile !== undefined && isEuRegion(fromProfile)) return fromProfile;
  if (fromProfile !== undefined) {
    console.warn(
      `[registre] ENF-DATA-01: AWS profile region "${fromProfile}" is outside the EU; deploying to ${DEFAULT_REGION} instead.`
    );
  }
  return DEFAULT_REGION;
}

/** True when the region belongs to the EU allow-list. */
export function isEuRegion(region: string): boolean {
  return (EU_REGIONS as readonly string[]).includes(region);
}

/** Returns the target account, falling back to a placeholder during offline synth. */
export function resolveAccount(env: NodeJS.ProcessEnv = process.env): string {
  return env.CDK_DEFAULT_ACCOUNT ?? env.AWS_ACCOUNT_ID ?? PLACEHOLDER_ACCOUNT;
}

/**
 * Model identifiers, defaulted to EU cross-region inference profiles.
 * The exact profile ids must be confirmed in the target region (chapter 24).
 */
function resolveModels(env: NodeJS.ProcessEnv): ModelIds {
  return {
    reasoning: env.REGISTRE_REASONING_MODEL ?? 'eu.anthropic.claude-sonnet-4-5-v1:0',
    answer: env.REGISTRE_ANSWER_MODEL ?? 'eu.anthropic.claude-sonnet-4-5-v1:0'
  };
}

/** Builds the whole configuration from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RegistreConfig {
  const retentionMonths = Number(env.REGISTRE_RETENTION_MONTHS ?? 24);
  return {
    appName: env.REGISTRE_APP_NAME ?? 'registre',
    region: resolveRegion(env),
    account: resolveAccount(env),
    retentionMonths,
    retentionDays: retentionMonths * 31,
    confidenceThreshold: Number(env.REGISTRE_CONFIDENCE_THRESHOLD ?? 0.85),
    reminderLeadDays: Number(env.REGISTRE_REMINDER_LEAD_DAYS ?? 30),
    defaultPeriodicity: env.REGISTRE_DEFAULT_PERIODICITY ?? 'P1Y',
    budgetUsd: Number(env.REGISTRE_BUDGET_USD ?? 80),
    alertEmail: env.REGISTRE_ALERT_EMAIL ?? 'quality-lead@example.com',
    mailDomain: env.REGISTRE_MAIL_DOMAIN ?? 'example.com',
    sourceBucketName: env.REGISTRE_SOURCE_BUCKET ?? 'registre-source-documents',
    dataAutomation: env.REGISTRE_DATA_AUTOMATION !== 'off',
    models: resolveModels(env)
  };
}

/** True when the region can host a Data Automation project (see the list above). */
export function supportsDataAutomation(region: string): boolean {
  return (DATA_AUTOMATION_REGIONS as readonly string[]).includes(region);
}

/** Deterministic resource name: `<app>-<suffix>` (kept inside AWS 64-char limits). */
export function resourceName(config: RegistreConfig, suffix: string): string {
  return `${config.appName}-${suffix}`;
}

/** Globally unique bucket name for a given purpose. */
export function bucketName(config: RegistreConfig, purpose: string): string {
  return `${config.appName}-${purpose}-${config.account}`.toLowerCase();
}
