/**
 * Offline service bundle: everything the API needs, wired from the modules that
 * already exist (memory store, mock AI, local vault, memory notifier).
 *
 * It is used in two situations:
 *  - `node src/api/server.ts` with no `src/bootstrap.ts` present, so the
 *    demonstration runs with no AWS account (R16, offline path);
 *  - the Lambda handlers, when no bootstrap module is deployed.
 *
 * The real bootstrap (`src/bootstrap.ts`, owned by the pilot) replaces it: the
 * API only ever sees the `Services` bundle, never the adapters.
 */

import { DEFAULT_SETTINGS } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { createMockAi } from '../ai/mock/index.ts';
import { InMemoryAuditSink, InMemoryStateStore, LocalEvidenceStore, MemoryCostMeter, MemoryNotifier } from '../store/index.ts';
import { clockFromEnv } from '../support/clock.ts';

/** Options of the offline bundle. */
export interface DemoServicesOptions {
  /** Root of the evidence vault; defaults to the `REGISTRE_VAULT_ROOT` value. */
  vaultRoot?: string;
  /** Freezes time when set, so a demonstration replays identically. */
  env?: NodeJS.ProcessEnv;
}

/** Builds the offline `Services` bundle (no network, no AWS). */
export function createDemoServices(options: DemoServicesOptions = {}): Services {
  const env = options.env ?? process.env;
  const clock = clockFromEnv(env);
  const settings = { ...DEFAULT_SETTINGS };
  const ai = createMockAi();
  return {
    clock,
    reader: ai.reader,
    controlRetriever: ai.controlRetriever,
    evidenceRetriever: ai.evidenceRetriever,
    reasoner: ai.reasoner,
    composer: ai.composer,
    guardrail: ai.guardrail,
    costs: ai.costs,
    evidenceStore:
      options.vaultRoot === undefined
        ? new LocalEvidenceStore({ clock })
        : new LocalEvidenceStore({ clock, root: options.vaultRoot }),
    state: new InMemoryStateStore({ clock, settings }),
    audit: new InMemoryAuditSink({ clock }),
    notifier: new MemoryNotifier({ clock }),
    settings
  };
}

/** A cost meter that only counts, for a bundle assembled from another source. */
export function emptyCostMeter(): MemoryCostMeter {
  return new MemoryCostMeter();
}
