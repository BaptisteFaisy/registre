/**
 * Deterministic `Guardrail` — the offline twin of Bedrock Guardrails
 * (ENF-CONF-02, ENF-IA-02).
 *
 *  - anchoring: every quoted span of the answer must be found in the retrieved
 *    passages, after normalisation (`containsNormalized`). A paraphrase is
 *    rejected: an audit answer cites or says nothing;
 *  - redaction: e-mail, phone, IBAN, card and national-id numbers are masked by
 *    the same rules the Bedrock adapter applies locally (`../pii.ts`).
 */

import type { AnchoringResult, Guardrail, RedactionResult } from '../../ports/index.ts';
import type { Passage } from '../../domain/types.ts';
import { unsupportedSpans } from '../anchoring.ts';
import { redactPii } from '../pii.ts';

/** Guardrail with no service behind it (EF-QR-02, ENF-CONF-02). */
export class MockGuardrail implements Guardrail {
  readonly id = 'mock-guardrail';

  /** True when every citation of the answer exists in the passages. */
  async verifyAnchoring(input: { answer: string; passages: readonly Passage[] }): Promise<AnchoringResult> {
    const unsupported = unsupportedSpans(input.answer, input.passages);
    return { anchored: input.passages.length > 0 && unsupported.length === 0, unsupported };
  }

  /** Masks personal data deterministically (ENF-CONF-02). */
  async redact(text: string): Promise<RedactionResult> {
    return redactPii(text);
  }
}

/** Factory used by `createMockAi` (ENF-CONF-02). */
export function createMockGuardrail(): Guardrail {
  return new MockGuardrail();
}
