/**
 * Hashing helpers — SHA-256 fingerprints for evidence integrity (ENF-INT-01)
 * and for the append-only audit chain (ENF-INT-02). Uses `node:crypto` only.
 */

import { createHash } from 'node:crypto';

/** SHA-256 of raw bytes, lowercase hex. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Stable SHA-256 of a JSON-serialisable value: keys are sorted so two objects
 * with the same content always produce the same digest.
 */
export function sha256Json(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

/** Deterministic JSON string with sorted object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

/** Short human-friendly fingerprint, for logs and pack indexes. */
export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
