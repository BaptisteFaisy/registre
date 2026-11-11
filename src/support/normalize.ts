/**
 * Text normalisation shared by quote verification, redaction checks and the
 * offline retriever. One implementation, reused everywhere (no duplicates).
 */

/** Unicode NFKC, case folded, punctuation and whitespace collapsed. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[’ʼ]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips every non-alphanumeric character, for fuzzy containment checks. */
export function squeeze(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9à-ÿ]+/gi, ' ');
}

/** Splits a text into sentences, keeping the original punctuation. */
export function sentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Splits a text into lowercase word tokens (length >= 2). */
export function tokens(value: string): string[] {
  return squeeze(value)
    .split(' ')
    .filter((token) => token.length >= 2);
}

/** Jaccard similarity over word tokens, 0..1. Cheap, deterministic, offline. */
export function similarity(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** True when `needle` appears in `haystack` after normalisation. */
export function containsNormalized(haystack: string, needle: string): boolean {
  const left = normalizeText(haystack);
  const right = normalizeText(needle);
  return right.length > 0 && left.includes(right);
}

/** True when `needle` appears in `haystack` ignoring punctuation entirely. */
export function containsSqueezed(haystack: string, needle: string): boolean {
  const left = squeeze(haystack);
  const right = squeeze(needle);
  return right.length > 0 && left.includes(right);
}

/** Truncates to `max` characters, appending an ellipsis when cut. */
export function excerpt(value: string, max = 240): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
