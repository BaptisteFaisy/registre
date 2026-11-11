/**
 * Composition root — builds the `Services` bundle from the environment.
 *
 * The whole product runs twice with the same code:
 *   - offline  : `REGISTRE_PROVIDER=mock` (default) — deterministic, offline,
 *                used by the tests, the demo and the judges' laptops;
 *   - on AWS   : `REGISTRE_PROVIDER=bedrock` — Data Automation, knowledge
 *                bases, structured output, Guardrails, Flex tier.
 *
 * Nothing else in the codebase reads `process.env` for infrastructure
 * choices: everything goes through this file.
 */

import type { Clock, Notifier, Services, StateStore, AuditSink } from './ports/index.ts';
import { DEFAULT_SETTINGS, type Settings } from './domain/types.ts';
import { SystemClock, clockFromEnv } from './support/clock.ts';
import { createAi, providerFromEnv } from './ai/index.ts';
import type { AiProvider, AiServices, MockAiOptions } from './ai/index.ts';
import {
  InMemoryAuditSink,
  InMemoryStateStore,
  LocalEvidenceStore,
  MemoryNotifier
} from './store/index.ts';
import { createMemoryExtensions } from './store/extensionsMemory.ts';
import { signerFromEnvAsync } from './crypto/localSigner.ts';
import type { ExtensionStore, Signer } from './ports/index.ts';

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
  /** Injected signer; defaults to `signerFromEnv`. */
  signer?: Signer;
  /** Injected extension store; defaults to the in-memory one. */
  extensions?: ExtensionStore;
}

export interface Bootstrapped {
  services: Services;
  ai: AiServices;
  provider: AiProvider;
  clock: Clock;
}

/**
 * Builds every service and wires them together.
 * Storage stays local by design: DynamoDB and S3 come into play through the
 * same ports when the deployment configuration asks for them.
 */
export async function createServices(options: BootstrapOptions = {}): Promise<Bootstrapped> {
  const env = options.env ?? process.env;
  const clock = options.now ? clockFromEnv({ ...env, REGISTRE_NOW: options.now }) : clockFromEnv(env);
  const provider = options.provider ?? providerFromEnv(env);

  const state = new InMemoryStateStore({ clock, settings: { ...DEFAULT_SETTINGS, ...options.settings } });
  const audit = new InMemoryAuditSink({ clock });
  const evidenceStore = new LocalEvidenceStore({ clock, root: options.vaultRoot });
  const notifier = new MemoryNotifier({ clock });
  const signer = options.signer ?? (await signerFromEnvAsync(env));
  const extensions = options.extensions ?? createMemoryExtensions({ clock });

  const settings = await state.getSettings();
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
      evidenceStore,
      state,
      audit,
      notifier,
      // The AI layer meters every Bedrock call: the portal shows the same
      // numbers the deployment would report (ENF-COUT-01).
      costs: ai.costs,
      settings,
      signer,
      extensions
    }
  };
}

/**
 * Convenience wrapper for callers that only need the bundle.
 */
export async function buildServices(options: BootstrapOptions = {}): Promise<Services> {
  const { services } = await createServices(options);
  return services;
}

/** Default clock used when no environment override is given. */
export const defaultClock = (): Clock => new SystemClock();

export type { StateStore, AuditSink, Notifier };
