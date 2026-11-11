/**
 * Contract of the `ai` module: the six ports of `src/ports/index.ts` it
 * implements, plus the cost meter (ENF-COUT-01), plus the provider name.
 *
 * Both `createMockAi` and `createBedrockAi` return this shape, so the pipeline
 * never knows which one it received — that is the whole point of the two
 * implementations (offline demo vs. AWS deployment).
 */

import type {
  AnswerComposer,
  ControlRetriever,
  CostMeter,
  EvidenceReader,
  EvidenceRetriever,
  Guardrail,
  Reasoner
} from '../ports/index.ts';

/** Which implementation of the `ai` module is active. */
export type AiProvider = 'mock' | 'bedrock';

/** Everything the `ai` module exposes to the pipeline. */
export interface AiServices {
  provider: AiProvider;
  /** EF-LEC-01..04 — document reading. */
  reader: EvidenceReader;
  /** EF-RAT-01 — candidate controls for one evidence. */
  controlRetriever: ControlRetriever;
  /** EF-QR-01/03 — evidence search filtered by clearance. */
  evidenceRetriever: EvidenceRetriever;
  /** EF-RAT-01/02, EF-SUF-01 — structured proposals and sufficiency. */
  reasoner: Reasoner;
  /** EF-QR-01/02 — cited answer. */
  composer: AnswerComposer;
  /** ENF-CONF-02, ENF-IA-02 — masking and anchoring. */
  guardrail: Guardrail;
  /** ENF-COUT-01 — cost per evidence. */
  costs: CostMeter;
}
