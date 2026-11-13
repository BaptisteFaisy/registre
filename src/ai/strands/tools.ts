/**
 * Tools of the auditor agent — EF-QR-01, EF-QR-02, EF-QR-03, ENF-IA-02.
 *
 * Pure functions, no SDK import: the agent adapter (`auditorAgent.ts`) wraps
 * them as Strands tools, and the tests call them directly.
 *
 * The access boundary is closed before the agent exists: every tool works only
 * on the passages `askQuestion` already filtered for the principal, so no tool
 * can reach an evidence the reader may not see (ENF-CONF-01). Passage text is
 * returned as data, fenced, never as instructions (ENF-IA-03).
 */

import type { Passage, TextPage } from '../../domain/types.ts';
import { verifyQuoteInPages } from '../../domain/citation.ts';
import { tokens } from '../../support/normalize.ts';

/** One evidence the agent may cite, as listed in its briefing. */
export interface EvidenceCard {
  evidenceId: string;
  title: string | null;
  documentDate: string | null;
  pages: number[];
}

/** One search hit returned to the agent. */
export interface PassageHit {
  evidenceId: string;
  title: string | null;
  page: number | null;
  score: number;
  excerpt: string;
}

/** Result of the agent's own quote check, before it cites. */
export interface QuoteCheck {
  evidenceId: string;
  found: boolean;
  page: number | null;
  hint: string;
}

/** Longest excerpt handed to the model per hit, to keep the loop cheap. */
export const MAX_EXCERPT_CHARS = 900;
/** Hits returned by one search. */
export const MAX_HITS = 5;

/** The evidences the agent is allowed to cite, without their text — EF-QR-03. */
export function evidenceCards(passages: readonly Passage[]): EvidenceCard[] {
  const cards = new Map<string, EvidenceCard>();
  for (const passage of passages) {
    const card = cards.get(passage.evidenceId) ?? {
      evidenceId: passage.evidenceId,
      title: passage.title,
      documentDate: passage.documentDate,
      pages: []
    };
    if (passage.page !== null && !card.pages.includes(passage.page)) {
      card.pages.push(passage.page);
    }
    cards.set(passage.evidenceId, card);
  }
  return [...cards.values()];
}

/** Ranks the allowed passages against a query by shared terms — EF-QR-01. */
export function searchPassages(passages: readonly Passage[], query: string): PassageHit[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  return passages
    .map((passage) => ({ passage, score: scoreOf(terms, passage.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS)
    .map(({ passage, score }) => ({
      evidenceId: passage.evidenceId,
      title: passage.title,
      page: passage.page,
      score: Math.round(score * 1000) / 1000,
      excerpt: fence(passage.text.slice(0, MAX_EXCERPT_CHARS))
    }));
}

/** The full retrieved text of one allowed evidence, page by page — EF-QR-01. */
export function readEvidence(passages: readonly Passage[], evidenceId: string): { found: boolean; pages: TextPage[] } {
  const pages = pagesOf(passages, evidenceId).map((page) => ({ page: page.page, text: fence(page.text) }));
  return { found: pages.length > 0, pages };
}

/**
 * Lets the agent check a quote before citing it — ENF-IA-02. The pipeline runs
 * the same check again after the agent: this tool saves a wasted answer, it is
 * not the guarantee.
 */
export function checkQuote(passages: readonly Passage[], evidenceId: string, quote: string): QuoteCheck {
  const pages = pagesOf(passages, evidenceId);
  if (pages.length === 0) {
    return { evidenceId, found: false, page: null, hint: 'This evidence is not among the passages you may cite.' };
  }
  const result = verifyQuoteInPages(pages, quote);
  return result.found
    ? { evidenceId, found: true, page: result.page, hint: 'Quote found verbatim: you may cite it.' }
    : { evidenceId, found: false, page: null, hint: 'Quote not found: copy a shorter passage exactly as written.' };
}

/** Pages of one evidence among the allowed passages. */
function pagesOf(passages: readonly Passage[], evidenceId: string): TextPage[] {
  return passages
    .filter((passage) => passage.evidenceId === evidenceId)
    .map((passage) => ({ page: passage.page ?? 0, text: passage.text }));
}

/** Distinct query terms of three letters or more. */
function termsOf(text: string): string[] {
  return [...new Set(tokens(text).filter((term) => term.length >= 3))];
}

/** Share of the query terms present in the passage. */
function scoreOf(terms: readonly string[], text: string): number {
  const words = new Set(tokens(text));
  return terms.filter((term) => words.has(term)).length / terms.length;
}

/** Marks passage text as untrusted data — ENF-IA-03. */
function fence(text: string): string {
  return `<<<document>>>\n${text}\n<<<end document>>>`;
}
