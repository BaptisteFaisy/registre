/**
 * Local PII redaction — ENF-CONF-02 (spec 9.3 EF-LEC-03, 16.2).
 *
 * "Les données personnelles sont masquées dans les extraits et les réponses."
 * This is the offline fallback used when Bedrock Guardrails is unavailable:
 * deterministic, stable masks, no network, no model.
 */

import type { RedactionResult } from '../ports/index.ts';

/** Stable replacement labels; they never vary between two runs — ENF-CONF-02. */
export const MASKS = {
  EMAIL: '[EMAIL]',
  PHONE: '[PHONE]',
  NIR: '[NIR]',
  IBAN: '[IBAN]',
  CARD: '[CARD]'
} as const;

/** Kind of personal data found in a text. */
export type PiiKind = keyof typeof MASKS;

/** Number of replacements per kind. */
export type PiiCounts = Record<PiiKind, number>;

/** One masking rule, applied in order (the order avoids overlapping matches). */
interface Rule {
  kind: PiiKind;
  pattern: RegExp;
}

/**
 * Ordered rules: e-mail first, then the longest numeric identifiers, then
 * phone numbers, so a 15-digit NIR is never mistaken for a card.
 */
const RULES: readonly Rule[] = [
  { kind: 'EMAIL', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'IBAN', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/g },
  { kind: 'NIR', pattern: /\b[12][ ]?\d{2}[ ]?(?:0[1-9]|1[0-2])[ ]?\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b/g },
  { kind: 'CARD', pattern: /\b(?:\d{4}[ -]?){3}\d{1,4}\b/g },
  { kind: 'CARD', pattern: /\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g },
  { kind: 'PHONE', pattern: /(?:\+33|0033)[ .-]?[1-9](?:[ .-]?\d{2}){4}\b/g },
  { kind: 'PHONE', pattern: /\b0[1-9](?:[ .-]?\d{2}){4}\b/g },
  { kind: 'PHONE', pattern: /\+\d{1,3}[ .-]?\d{2,4}(?:[ .-]?\d{2,4}){1,3}\b/g }
];

/** Zeroed per-kind counter — ENF-CONF-02. */
export function emptyPiiCounts(): PiiCounts {
  return { EMAIL: 0, PHONE: 0, NIR: 0, IBAN: 0, CARD: 0 };
}

/** Masks personal data in a text and reports the hits — ENF-CONF-02. */
export function redactText(text: string): RedactionResult & { counts: PiiCounts } {
  const counts = emptyPiiCounts();
  let output = text;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, () => {
      counts[rule.kind] += 1;
      return MASKS[rule.kind];
    });
  }
  const hits = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { text: output, redacted: hits > 0, hits, counts };
}

/** True when the text carries at least one recognised personal datum — ENF-CONF-02. */
export function containsPersonalData(text: string): boolean {
  return redactText(text).redacted;
}

/** Masks personal data in several passages, e.g. retrieved excerpts — ENF-CONF-02. */
export function redactAll(texts: readonly string[]): { texts: string[]; hits: number } {
  const results = texts.map((text) => redactText(text));
  return { texts: results.map((result) => result.text), hits: results.reduce((sum, r) => sum + r.hits, 0) };
}
