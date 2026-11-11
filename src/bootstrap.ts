/**
 * Composition root — builds the `Services` bundle from the environment.
 *
 * The whole product runs twice with the same code:
 *   - offline  : `REGISTRE_PROVIDER=mock` (default) — deterministic, offline,
 *                used by the tests, the demo and the judges' laptops;
 *   - on AWS   : `REGISTRE_PROVIDER=bedrock` — Data Automation, knowledge
 *                bases, structured output, Guardrails, Flex tier.
 *
 * The same switch selects the storage adapters, so a Lambda and a laptop run the
 * identical pipeline:
 *
 *   | environment              | adapter                              |
 *   | ------------------------ | ------------------------------------ |
 *   | `REGISTRE_TABLE`         | DynamoDB state, audit and extensions |
 *   | (absent)                 | in-memory state, audit, extensions   |
 *   | `REGISTRE_VAULT_BUCKET`  | S3 evidence vault                    |
 *   | (absent)                 | local filesystem vault               |
 *   | `REGISTRE_SES_FROM`      | SES notifications                    |
 *   | (absent)                 | in-memory notifier (captures mails)  |
 *   | `REGISTRE_SIGNER=kms`    | KMS pack signing                     |
 *   | (absent)                 | local Ed25519 signing                |
 *
 * Nothing else in the codebase reads `process.env` for infrastructure choices:
 * everything goes through this file.
 */

import type { AuditSink, Clock, ExtensionStore, Notifier, Services, Signer, StateStore } from './ports/index.ts';
import { DEFAULT_SETTINGS, type Settings } from './domain/types.ts';
import { SystemClock, clockFromEnv } from './support/clock.ts';
import { createAi, providerFromEnv } from './ai/index.ts';
import type { AiProvider, AiServices, MockAiOptions } from './ai/index.ts';
import {
  DynamoAuditSink,
  DynamoExtensionStore,
  DynamoStateStore,
  InMemoryAuditSink,
  InMemoryStateStore,
  LocalEvidenceStore,
  MemoryNotifier
} from './store/index.ts';
import { createMemoryExtensions } from './store/extensionsMemory.ts';
import { SES_FROM_ENV, SesNotifier, sesOptionsFromEnv } from './notify/index.ts';
import { signerFromEnvAsync } from './crypto/localSigner.ts';
import type { EvidenceStore } from './ports/index.ts';

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
  /** Overrides the provider selection (default: `REGISTRE_PROVIDER`). */
  provider?: AiProvider;
  /** Freezes the clock (demo, tests, evaluation datasets). */
  now?: string;
  /** Mock catalogue injected into the offline provider. */
  mock?: MockAiOptions;
  /** Overrides the settings read from the store. */
  settings?: Partial<Settings>;
  /** Vault root for the local evidence store. */
  vaultRoot?: string;
  /** Injected signer; defaults to `signerFromEnvAsync`. */
  signer?: Signer;
  /** Injected extension store; defaults to the environment-driven choice. */
  extensions?: ExtensionStore;
}

export interface Bootstrapped {
  services: Services;
  ai: AiServices;
  provider: AiProvider;
  clock: Clock;
}

/** Environment variable names this composition root understands. */
export const ENV = {
  table: 'REGISTRE_TABLE',
  vaultBucket: 'REGISTRE_VAULT_BUCKET',
  vaultPrefix: 'REGISTRE_VAULT_PREFIX',
  region: 'REGISTRE_REGION',
  guardrailId: 'REGISTRE_GUARDRAIL_ID',
  reasoningModel: 'REGISTRE_REASONING_MODEL',
  answerModel: 'REGISTRE_ANSWER_MODEL',
  confidenceThreshold: 'REGISTRE_CONFIDENCE_THRESHOLD',
  reminderLeadDays: 'REGISTRE_REMINDER_LEAD_DAYS',
  retentionMonths: 'REGISTRE_RETENTION_MONTHS',
  nightlyTier: 'REGISTRE_NIGHTLY_TIER'
} as const;

/**
 * Builds every service and wires them together.
 */
export async function createServices(options: BootstrapOptions = {}): Promise<Bootstrapped> {
  const env = options.env ?? process.env;
  const clock = options.now ? clockFromEnv({ ...env, REGISTRE_NOW: options.now }) : clockFromEnv(env);
  const provider = options.provider ?? providerFromEnv(env);

  const seeded = { ...DEFAULT_SETTINGS, ...settingsFromEnv(env), ...options.settings };
  const state = createStateStore(env, clock, seeded);
  const settings = await resolveSettings(state, seeded);
  const ai = createAi(env, settings, options.mock ? { mock: options.mock } : {});

  return {
    ai,
    provider,
    clock,
    services: {
      clock,
      reader: ai.reader,
      controlRetriever: ai.controlRetriever,
      evidenceRetriever: ai.evidenceRetriever,
      reasoner: ai.reasoner,
      composer: ai.composer,
      guardrail: ai.guardrail,
      evidenceStore: await createEvidenceStore(env, clock, options.vaultRoot),
      state,
      audit: createAuditSink(env, clock),
      notifier: createNotifier(env, clock),
      // The AI layer meters every Bedrock call: the portal shows the same
      // numbers the deployment would report (ENF-COUT-01).
      costs: ai.costs,
      settings,
      signer: options.signer ?? (await signerFromEnvAsync(env)),
      extensions: options.extensions ?? createExtensions(env, clock)
    }
  };
}

/** Convenience wrapper for callers that only need the bundle. */
export async function buildServices(options: BootstrapOptions = {}): Promise<Services> {
  const { services } = await createServices(options);
  return services;
}

/** Default clock, exported for adapters that build their own. */
export const defaultClock = (): Clock => new SystemClock();

/**
 * Deployment settings read from the environment. Only the variables actually
 * present are returned, so a caller's explicit option always wins.
 */
export function settingsFromEnv(env: NodeJS.ProcessEnv): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (env[ENV.region]) out.region = env[ENV.region]!;
  if (env[ENV.guardrailId]) out.guardrailId = env[ENV.guardrailId]!;
  if (env[ENV.reasoningModel]) out.reasoningModel = env[ENV.reasoningModel]!;
  if (env[ENV.answerModel]) out.answerModel = env[ENV.answerModel]!;
  const threshold = Number(env[ENV.confidenceThreshold]);
  if (Number.isFinite(threshold) && env[ENV.confidenceThreshold]) out.confidenceThreshold = threshold;
  const leadDays = Number(env[ENV.reminderLeadDays]);
  if (Number.isFinite(leadDays) && env[ENV.reminderLeadDays]) out.reminderLeadDays = leadDays;
  const retention = Number(env[ENV.retentionMonths]);
  if (Number.isFinite(retention) && env[ENV.retentionMonths]) out.retentionMonths = retention;
  const tier = env[ENV.nightlyTier]?.toUpperCase();
  if (tier === 'FLEX' || tier === 'STANDARD') out.nightlyServiceTier = tier;
  return out;
}

/**
 * Settings actually used: the environment seeds the store on a first run, then
 * the store wins, so a quality lead's runtime change (`PUT /v1/settings`)
 * survives a Lambda cold start.
 */
async function resolveSettings(state: StateStore, seeded: Settings): Promise<Settings> {
  const stored = await state.getSettings();
  if (sameSettings(stored, DEFAULT_SETTINGS) && !sameSettings(stored, seeded)) {
    await state.putSettings(seeded);
    return seeded;
  }
  return stored;
}

function sameSettings(left: Settings, right: Settings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** DynamoDB when a table is configured, in-memory otherwise. */
export function createStateStore(env: NodeJS.ProcessEnv, clock: Clock, settings: Settings): StateStore {
  if (!env[ENV.table]) return new InMemoryStateStore({ clock, settings });
  return new DynamoStateStore(undefined, clock);
}

/** The audit sink follows the state store: one persistence, one behaviour. */
export function createAuditSink(env: NodeJS.ProcessEnv, clock: Clock): AuditSink {
  return env[ENV.table] ? new DynamoAuditSink(undefined, clock) : new InMemoryAuditSink({ clock });
}

/** Shares, mappings, drifts, quality and verification log. */
export function createExtensions(env: NodeJS.ProcessEnv, clock: Clock): ExtensionStore {
  return env[ENV.table] ? new DynamoExtensionStore({ clock }) : createMemoryExtensions({ clock });
}

/** SES when a sender identity is configured, in-memory capture otherwise. */
export function createNotifier(env: NodeJS.ProcessEnv, clock: Clock): Notifier {
  const from = env[SES_FROM_ENV];
  if (from === undefined || from.trim().length === 0) return new MemoryNotifier({ clock });
  return new SesNotifier({ ...sesOptionsFromEnv(env), clock });
}

/** S3 vault when a bucket is configured, local filesystem otherwise. */
export async function createEvidenceStore(
  env: NodeJS.ProcessEnv,
  clock: Clock,
  vaultRoot?: string
): Promise<EvidenceStore> {
  const bucket = env[ENV.vaultBucket];
  if (!bucket) return new LocalEvidenceStore({ clock, ...(vaultRoot === undefined ? {} : { root: vaultRoot }) });
  // Lazy: the offline path never loads the AWS SDK.
  const { S3EvidenceStore } = await import('./store/vaultS3.ts');
  return new S3EvidenceStore({
    bucket,
    clock,
    ...(env[ENV.region] === undefined ? {} : { region: env[ENV.region] }),
    ...(env[ENV.vaultPrefix] === undefined ? {} : { prefix: env[ENV.vaultPrefix] })
  });
}

export type { StateStore, AuditSink, Notifier };
