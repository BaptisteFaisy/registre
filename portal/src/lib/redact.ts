/**
 * Personal-data masking for displayed extracts (EF-LEC-03, ENF-CONF-02).
 *
 * The real masking happens in Bedrock Guardrails before the text leaves AWS;
 * the portal masks again before rendering, so a screenshot can never leak a
 * name, an e-mail address or a phone number.
 */

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;
const PHONE = /\+?\b\d{2}(?:[ .-]?\d{2}){4}\b/g;
const PERSON = /\b[A-Z][a-zà-ÿ]+ [A-Z][a-zà-ÿ]+\b/g;

const MASK = '[masked]';

/** Replaces names, e-mails and phone numbers with a neutral marker. */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, MASK).replace(PHONE, MASK).replace(PERSON, MASK);
}

/** True when the text still contains something that looks personal. */
export function looksPersonal(text: string): boolean {
  return maskPersonalData(text) !== text;
}
