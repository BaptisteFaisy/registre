/**
 * Mock wiring — `createMockAi(options)`, the offline implementation of the whole
 * `ai` module (CONTRACTS.md §2.8: tests never touch the network).
 *
 * The price list and the cost meter live in `../bedrock/costs.ts` and are shared
 * with the real adapters: it is pure arithmetic, so the offline demo displays a
 * cost per evidence with the same numbers the deployment would report
 * (ENF-COUT-01). Nothing in that file loads the AWS SDK.
 *
 * A caller can inject its own catalogue (controls, evidences) and its own script
 * (per-evidence proposals and sufficiency elements). Everything else falls back
 * to a deterministic heuristic, so a demo scenario needs no fixture at all.
 */

import type { Control, Evidence } from '../../domain/types.ts';
import type { AiServices } from '../types.ts';
import { InMemoryCostMeter } from '../bedrock/costs.ts';
import { createScriptedReader } from './scriptedReader.ts';
import { createScriptedReasoner } from './scriptedReasoner.ts';
import type { ReasonerScript } from './scriptedReasoner.ts';
import { createControlRetriever, createEvidenceRetriever } from './mockRetrievers.ts';
import { createMockGuardrail } from './mockGuardrail.ts';
import { createMockComposer } from './mockComposer.ts';

export interface MockAiOptions {
  /** Controls the frameworks knowledge base would hold (EF-RAT-01). */
  controls?: readonly Control[];
  /** Evidences the evidence knowledge base would hold (EF-QR-01). */
  evidences?: readonly Evidence[];
  /** Scripted model answers; the heuristic runs when a key is absent. */
  script?: ReasonerScript;
}

/**
 * Builds the six offline services (EF-LEC-01, EF-RAT-01, EF-QR-01).
 * Deterministic: no clock, no randomness, no network.
 */
export function createMockAi(options: MockAiOptions = {}): AiServices {
  const costs = new InMemoryCostMeter();
  return {
    provider: 'mock',
    reader: createScriptedReader({ meter: costs }),
    controlRetriever: createControlRetriever(options.controls ?? []),
    evidenceRetriever: createEvidenceRetriever(options.evidences ?? []),
    reasoner: createScriptedReasoner(options.script ?? {}),
    composer: createMockComposer(),
    guardrail: createMockGuardrail(),
    costs
  };
}

export { createScriptedReader } from './scriptedReader.ts';
export { createScriptedReasoner, heuristicProposals, heuristicElements, evidenceSearchText } from './scriptedReasoner.ts';
export type { ReasonerScript } from './scriptedReasoner.ts';
export { MemoryControlRetriever, MemoryEvidenceRetriever, createControlRetriever, createEvidenceRetriever } from './mockRetrievers.ts';
export { MockGuardrail, createMockGuardrail } from './mockGuardrail.ts';
export { MockComposer, createMockComposer, bestPassage, provenance } from './mockComposer.ts';
