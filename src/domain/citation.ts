/**
 * Quote verification — EF-RAT-02 and ENF-IA-02.
 *
 * Spec 13.2: "Le code vérifie que chaque passage cité existe bien dans la
 * preuve. Une citation introuvable annule le rattachement."
 * Spec 13.4: every claim of an answer must be backed by a verifiable quote.
 *
 * The search is done page by page so the returned citation carries the real
 * page of the evidence (and not the page guessed by the model).
 */

import type { Answer, Evidence, EvidenceId, TextPage } from './types.ts';
import { containsNormalized, containsSqueezed } from '../support/normalize.ts';

/** Shortest quote the code accepts: below this, a match would prove nothing. */
export const MIN_QUOTE_LENGTH = 8;

/** Why a quote could not be verified. */
export type QuoteFailure = 'EMPTY' | 'TOO_SHORT' | 'NOT_FOUND';

/** Outcome of one quote check. */
export interface QuoteCheck {
  /** True when the quote was found in at least one page. */
  found: boolean;
  /** Page holding the match; null when not found. */
  page: number | null;
  /** True for a normalised match, false for the punctuation-insensitive fallback. */
  exact: boolean;
  /** Reason of the failure; null when `found` is true. */
  failure: QuoteFailure | null;
}

function failed(failure: QuoteFailure): QuoteCheck {
  return { found: false, page: null, exact: false, failure };
}

/** True when a quote is long enough to be checked at all — EF-RAT-02. */
export function isVerifiableQuote(quote: string): boolean {
  return quote.trim().length >= MIN_QUOTE_LENGTH;
}

/**
 * Verifies one quote page by page, tolerating case, spacing and punctuation —
 * EF-RAT-02. Returns the page where the passage really is.
 */
export function verifyQuoteInPages(pages: readonly TextPage[], quote: string): QuoteCheck {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return failed('EMPTY');
  if (!isVerifiableQuote(trimmed)) return failed('TOO_SHORT');
  const needle = stripOuterPunctuation(trimmed);
  if (needle.length === 0) return failed('TOO_SHORT');
  for (const page of pages) {
    if (containsNormalized(page.text, needle)) return { found: true, page: page.page, exact: true, failure: null };
  }
  for (const page of pages) {
    if (containsSqueezed(page.text, needle)) return { found: true, page: page.page, exact: false, failure: null };
  }
  return failed('NOT_FOUND');
}

/** Drops the quotes and punctuation a model may wrap around a quoted passage. */
function stripOuterPunctuation(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}

/** Verifies a quote against the extracted pages of one evidence — EF-RAT-02. */
export function verifyQuote(evidence: Pick<Evidence, 'textPages'>, quote: string): QuoteCheck {
  return verifyQuoteInPages(evidence.textPages, quote);
}

/** One citation of an answer, re-checked by code. */
export interface CitationCheck {
  evidenceId: EvidenceId;
  quote: string;
  found: boolean;
  /** Page where the quote was actually found (null when not found). */
  page: number | null;
  failure: QuoteFailure | 'UNKNOWN_EVIDENCE' | null;
}

/** Anchoring report of a whole answer — ENF-IA-02. */
export interface CitationReport {
  checks: CitationCheck[];
  /** Quotes that could not be traced back to an evidence. */
  unsupported: string[];
  /** True when the answer cites at least one passage and every citation holds. */
  anchored: boolean;
}

/**
 * Verifies every citation of an answer against the evidences it names —
 * EF-QR-01, ENF-IA-02.
 */
export function verifyAnswerCitations(answer: Answer, evidences: Map<EvidenceId, Evidence>): CitationReport {
  const checks = answer.citations.map((citation) => checkCitation(citation, evidences));
  const unsupported = checks.filter((check) => !check.found).map((check) => check.quote);
  return { checks, unsupported, anchored: checks.length > 0 && unsupported.length === 0 };
}

function checkCitation(
  citation: Answer['citations'][number],
  evidences: Map<EvidenceId, Evidence>
): CitationCheck {
  const evidence = evidences.get(citation.evidenceId);
  if (!evidence) {
    return { evidenceId: citation.evidenceId, quote: citation.quote, found: false, page: null, failure: 'UNKNOWN_EVIDENCE' };
  }
  const check = verifyQuote(evidence, citation.quote);
  return { evidenceId: citation.evidenceId, quote: citation.quote, found: check.found, page: check.page, failure: check.failure };
}
