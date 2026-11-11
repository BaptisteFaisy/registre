/**
 * Base64 encoding of raw bytes, without a DOM and without Node APIs.
 *
 * A manual deposit travels inside a JSON envelope, so the document bytes must
 * be encoded. The helper runs in the browser and in the unit tests under Node,
 * hence a plain implementation: no `btoa`, no `atob`, no `Buffer`.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VALUES: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((character, index) => [character, index])
);

/** Encodes bytes as standard base64, with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += ALPHABET[first >> 2] ?? '';
    output += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)] ?? '';
    output += second === undefined ? '=' : (ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)] ?? '');
    output += third === undefined ? '=' : (ALPHABET[third & 0x3f] ?? '');
  }
  return output;
}

/** Decodes standard base64 (with or without padding) back to its bytes. */
export function base64ToBytes(text: string): Uint8Array {
  const stripped = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((stripped.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of stripped) {
    const value = VALUES.get(character);
    if (value === undefined) throw new Error(`Not a base64 character: ${character}`);
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return bytes.subarray(0, written);
}

/** Encodes a string as UTF-8 bytes. */
export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
