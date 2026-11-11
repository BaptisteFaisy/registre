/**
 * Vocabulary guard. Enforces ENF-IA-01 across the codebase, reports, and UI.
 *
 * "The tool NEVER uses the word 'compliant' for a control."
 * Compliance is an auditor's judgment, not a machine state. Registre only says
 * whether evidence exists, is fresh, and contains what was expected.
 *
 * Keep under 500 lines; no dependencies.
 */

import { badRequest } from '../support/errors.ts';

/** Forbidden words when speaking about a control or a sufficiency verdict. */
export const FORBIDDEN_STEMS: readonly string[] = [
  'conforme',
  'conformes',
  'non-conforme',
  'non conforme',
  'compliant',
  'compliants',
  'non-compliant',
  'non compliant',
  'in compliance',
  'en conformité',
  'non-conformité'
] as const;

/**
 * The nouns "compliance" and "conformité" stay allowed: they name the discipline
 * (a compliance officer, a compliance calendar), they never qualify a control.
 * What ENF-IA-01 forbids is the judgement - the adjective applied to a control.
 */
export const ALLOWED_NOUNS: readonly string[] = ['compliance', 'conformité'] as const;

/** Regex matching forbidden stems with French/English word boundaries. */
/**
 * Source of the forbidden pattern. Accented forms need `\p{L}` lookarounds
 * instead of `\b` (JavaScript word boundaries are ASCII-only, so `conformité`
 * would otherwise never match). Compiled fresh on every call: a shared global
 * regex keeps `lastIndex` state and would skip every other match.
 */
const FORBIDDEN_SOURCE =
  '(?<!\\p{L})(non[- ]?conformes?|conformes?|non[- ]?compliants?|compliants?|in compliance|en conformit[eé]|non[- ]?conformit[eé]s?)(?!\\p{L})';

/** True when text contains any form of "compliant" / "conforme". */
export function containsForbiddenWord(text: string): boolean {
  return new RegExp(FORBIDDEN_SOURCE, 'iu').test(text);
}

/** Finds every match with byte offset and surrounding context. */
export interface Violation {
  word: string;
  index: number;
  snippet: string;
}

export function findViolations(text: string): Violation[] {
  const matches: Violation[] = [];
  const regex = new RegExp(FORBIDDEN_SOURCE, 'giu');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(text.length, match.index + match[0].length + 30);
    matches.push({
      word: match[0],
      index: match.index,
      snippet: text.slice(start, end).replace(/\s+/g, ' ')
    });
  }
  return matches;
}

/**
 * Throws `BAD_REQUEST` if the text uses a forbidden word in a context that
 * qualifies a control state or an automated judgment.
 */
export function assertForbiddenWordsAbsent(text: string, context = 'output'): void {
  const violations = findViolations(text);
  if (violations.length === 0) return;
  const sample = violations.map((v) => `"${v.word}" at ${v.index} (${v.snippet})`).join('; ');
  throw badRequest(`ENF-IA-01 violation: "${context}" uses forbidden wording: ${sample}`);
}

/** Allowed replacement phrasing that preserves audit nuance. */
export const RECOMMENDED_VOCABULARY = {
  covered: 'covered / couvert (applied evidence is fresh and complete)',
  toRenew: 'to renew / à renouveler (best evidence expires within 30 days)',
  toVerify: 'to verify / à vérifier (uncertain attachment or partial elements)',
  expired: 'expired / périmé (applied evidence is older than periodicity)',
  noEvidence: 'no evidence / sans preuve (no applied evidence)',
  complete: 'complete / complète (every expected element is present)',
  partial: 'partial / partielle (one or more expected elements are missing)'
} as const;
