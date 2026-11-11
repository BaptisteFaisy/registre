/**
 * Deterministic PII masking — ENF-CONF-02 ("personal data is masked in excerpts
 * and answers").
 *
 * Bedrock Guardrails does the semantic work on AWS; this local pass is the
 * offline twin and the last safety net after the service call, so a guardrail
 * outage never lets an e-mail address through. Same rules both sides: one
 * implementation, used by `mockGuardrail.ts` and `bedrock/guardrails.ts`.
 *
 * Every rule carries a validator that counts digits, so an ordinary date
 * ("2026 11 11") is never mistaken for a phone number.
 */

/** Replacement tokens, stable so tests and the demo can assert on them. */
export const PII_TOKENS = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  iban: '[IBAN]',
  card: '[CARD]',
  nationalId: '[NATIONAL_ID]'
} as const;

interface PiiRule {
  pattern: RegExp;
  token: string;
  /** Extra guard: false means "not PII, leave it alone". */
  accept: (match: string) => boolean;
}

/** Digits of a match, separators removed. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** A 4-2-2 or 2-2-4 group is a date, never a phone number. */
function looksLikeDate(value: string): boolean {
  return /^\d{4}[ .\-/]\d{1,2}[ .\-/]\d{1,2}$/.test(value.trim()) || /^\d{1,2}[ .\-/]\d{1,2}[ .\-/]\d{2,4}$/.test(value.trim());
}

const RULES: readonly PiiRule[] = [
  {
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
    token: PII_TOKENS.iban,
    accept: (match) => digitsOf(match).length >= 10
  },
  {
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    token: PII_TOKENS.card,
    accept: (match) => {
      const digits = digitsOf(match).length;
      return digits >= 13 && digits <= 19 && !looksLikeDate(match);
    }
  },
  {
    pattern: /\b[\w.%+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    token: PII_TOKENS.email,
    accept: () => true
  },
  {
    pattern: /\b\d[ ]\d{2}[ ]\d{2}[ ]\d{2}[ ]\d{3}[ ]\d{3}\b/g,
    token: PII_TOKENS.nationalId,
    accept: (match) => digitsOf(match).length === 13
  },
  {
    pattern: /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{1,4}\)?[ .-]){1,4}\d{2,4}\b/g,
    token: PII_TOKENS.phone,
    accept: (match) => {
      const digits = digitsOf(match).length;
      return digits >= 9 && digits <= 15 && !looksLikeDate(match);
    }
  }
];

export interface RedactionOutcome {
  text: string;
  redacted: boolean;
  hits: number;
}

/** Replaces every accepted match of one rule, counting the hits. */
function applyRule(text: string, rule: PiiRule, counter: { hits: number }): string {
  return text.replace(rule.pattern, (match: string) => {
    if (match.includes(rule.token)) return match;
    if (!rule.accept(match)) return match;
    counter.hits += 1;
    return rule.token;
  });
}

/**
 * Masks e-mail addresses, phone numbers, IBANs, card and national-id numbers
 * (ENF-CONF-02). Pure and idempotent: masking twice changes nothing.
 */
export function redactPii(text: string): RedactionOutcome {
  const counter = { hits: 0 };
  let output = text;
  for (const rule of RULES) output = applyRule(output, rule, counter);
  return { text: output, redacted: counter.hits > 0, hits: counter.hits };
}

/** True when the text still carries something that looks like PII. */
export function containsPii(text: string): boolean {
  return redactPii(text).hits > 0;
}
