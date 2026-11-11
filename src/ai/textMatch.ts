/**
 * Sentence-level matching shared by the offline reasoner and the offline
 * composer: given a text and a target (a question, a requirement, an expected
 * item), find the sentence of the text closest to the target.
 *
 * Why a shared helper: both mocks must quote a REAL sentence of the document,
 * otherwise the code-side quote check would behave differently from production.
 * One implementation, used by both (CONTRACTS.md §2.2).
 */

import { similarity, sentences } from '../support/normalize.ts';

/** A sentence shorter than this cannot be quoted as evidence. */
export const MIN_QUOTE_SENTENCE_CHARS = 8;

export interface SentenceMatch {
  sentence: string;
  score: number;
}

/**
 * Closest sentence of `text` to `target`, or null when the text has no
 * sentence long enough to be quoted. Ties keep the earliest sentence, so the
 * result is deterministic.
 */
export function bestSentence(text: string, target: string): SentenceMatch | null {
  let best: SentenceMatch | null = null;
  for (const sentence of sentences(text)) {
    if (sentence.length < MIN_QUOTE_SENTENCE_CHARS) continue;
    const score = similarity(sentence, target);
    if (!best || score > best.score) best = { sentence, score };
  }
  return best;
}
