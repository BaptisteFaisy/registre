/**
 * Citation extraction and anchoring — ENF-IA-02 ("every claim of an answer is
 * backed by a verifiable citation").
 *
 * Shared by the Bedrock guardrail (which adds a semantic grounding check) and by
 * the deterministic mock guardrail: the *literal* check — is the cited passage
 * really in the retrieved passages? — is code, not a model call.
 *
 * A span that merely names a retrieved document (its title) is provenance, not a
 * claim: it is accepted as soon as it matches the title of one of the passages.
 */

import type { Passage } from '../domain/types.ts';
import { containsNormalized, normalizeText, sentences } from '../support/normalize.ts';

/** Minimum length of a span that must be verifiable (mirrors the prompts). */
export const MIN_SPAN_CHARS = 8;

/** Sentences shorter than this are not treated as assertions. */
export const MIN_ASSERTION_CHARS = 24;

/** Quoted spans ("…" and «…») of an answer, or its sentences when unquoted. */
export function citedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of text.matchAll(/"([^"\n]{8,400})"|«([^»\n]{8,400})»/g)) {
    const span = (match[1] ?? match[2] ?? '').trim();
    if (span.length >= MIN_SPAN_CHARS) spans.push(span);
  }
  if (spans.length > 0) return spans;
  return sentences(text).filter((sentence) => sentence.length >= MIN_ASSERTION_CHARS);
}

/** Full text of the retrieved passages, as one haystack. */
export function passagesText(passages: readonly Passage[]): string {
  return passages.map((passage) => passage.text).join('\n');
}

/** Normalised titles of the retrieved documents, used to accept provenance. */
export function passageTitles(passages: readonly Passage[]): string[] {
  return passages
    .map((passage) => normalizeText(passage.title ?? ''))
    .filter((title) => title.length > 0);
}

/** True when the span only names a retrieved document. */
export function isProvenance(span: string, titles: readonly string[]): boolean {
  const value = normalizeText(span);
  return titles.some((title) => title === value || title.includes(value));
}

/** Spans of the answer that cannot be found in any passage (ENF-IA-02). */
export function unsupportedSpans(answer: string, passages: readonly Passage[]): string[] {
  const haystack = passagesText(passages);
  const titles = passageTitles(passages);
  return citedSpans(answer).filter(
    (span) => !isProvenance(span, titles) && !containsNormalized(haystack, span)
  );
}

/** True when every quoted span of the answer is present in the passages. */
export function isLiterallyAnchored(answer: string, passages: readonly Passage[]): boolean {
  if (passages.length === 0) return false;
  return unsupportedSpans(answer, passages).length === 0;
}
