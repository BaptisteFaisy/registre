/**
 * Deterministic pseudo-randomness for the offline mock.
 *
 * The demo must look identical on every machine and in every recording, so no
 * `Math.random()` and no `Date.now()`: every value is derived from a seed.
 */

/** FNV-1a 32-bit hash of a string. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Hex digest of the given length, derived from the seed (stand-in for SHA-256). */
export function hexDigest(seed: string, length = 64): string {
  let value = fnv1a(seed);
  let output = '';
  while (output.length < length) {
    value = (Math.imul(value, 0x01000193) ^ output.length) >>> 0;
    output += value.toString(16).padStart(8, '0');
  }
  return output.slice(0, length);
}

/** Integer in [min, max] derived from the seed. */
export function seededInt(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (fnv1a(seed) % span);
}

/** Picks one element of a non-empty array from the seed. */
export function seededPick<T>(seed: string, values: readonly T[]): T {
  const index = fnv1a(seed) % values.length;
  return values[index] as T;
}
