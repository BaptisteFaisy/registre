/**
 * Deterministic `AnswerComposer` — the offline twin of the Bedrock answer call
 * (EF-QR-01, EF-QR-02).
 *
 * The answer is built from the best passage only: it names the document, the
 * page and the document date, then quotes the sentence of that passage closest
 * to the question. The quote is copied, never paraphrased, so the anchoring check
 * that follows behaves exactly as it would on AWS.
 *
 * No passage means `NO_EVIDENCE_ANSWER`, with no citation (EF-QR-02).
 */

import type { AnswerComposer, DraftAnswer } from '../../ports/index.ts';
import type { Passage } from '../../domain/types.ts';
import { NO_EVIDENCE_ANSWER } from '../../domain/types.ts';
import { bestSentence } from '../textMatch.ts';

/** Best passage: highest score, first one on a tie (stable). */
export function bestPassage(passages: readonly Passage[]): Passage | null {
  let best: Passage | null = null;
  for (const passage of passages) if (!best || passage.score > best.score) best = passage;
  return best;
}

/** Provenance line of a passage: document, page, date (EF-QR-01). */
export function provenance(passage: Passage): string {
  const parts = [`"${passage.title ?? 'untitled document'}"`];
  if (passage.page !== null) parts.push(`page ${passage.page}`);
  if (passage.documentDate) parts.push(`dated ${passage.documentDate}`);
  return parts.join(', ');
}

/**
 * Composes a cited answer from the retrieved passages (EF-QR-01).
 * When the question shares nothing with the best passage, the answer still
 * cites it — the anchoring check, not the composer, decides whether it stands.
 */
export class MockComposer implements AnswerComposer {
  readonly id = 'mock-composer';

  async compose(input: { question: string; passages: Passage[] }): Promise<DraftAnswer> {
    const best = bestPassage(input.passages);
    if (!best) return { text: NO_EVIDENCE_ANSWER, citations: [] };
    const match = bestSentence(best.text, input.question);
    const quote = match?.sentence ?? best.text.trim().slice(0, 240);
    if (quote.length < 8) return { text: NO_EVIDENCE_ANSWER, citations: [] };
    return {
      text: `According to ${provenance(best)}: "${quote}"`,
      citations: [{ evidenceId: best.evidenceId, quote, page: best.page }]
    };
  }
}

/** Factory used by `createMockAi` (EF-QR-01). */
export function createMockComposer(): AnswerComposer {
  return new MockComposer();
}
