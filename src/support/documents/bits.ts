/**
 * Shared low-level helpers for the demo's real binary writers (PNG, ZIP and the
 * OOXML formats built on top of it). Single implementation, reused everywhere —
 * no module may roll its own CRC-32, little-endian writer or string encoder.
 *
 * Everything here is deterministic and dependency-free; it relies on `node:zlib`
 * for CRC-32 and DEFLATE (available on Node 22+).
 */

import { crc32 as zlibCrc32, deflateRawSync, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

/** Concatenates byte arrays (or plain number arrays) into one. */
export function concatBytes(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    const bytes = part instanceof Uint8Array ? part : Uint8Array.from(part);
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

/** Encodes array elements as raw bytes (values clamped to 0..255). */
export function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values.map((value) => value & 0xff));
}

/** CRC-32 (IEEE 802.3), 32-bit unsigned, matching PNG and ZIP conventions. */
export function crc32(bytes: Uint8Array): number {
  return zlibCrc32(Buffer.from(bytes)) >>> 0;
}

/** Raw DEFLATE (RFC 1951), for ZIP method 8 entries. */
export function deflate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(deflateRawSync(Buffer.from(bytes)));
}

/**
 * zlib-wrapped DEFLATE (RFC 1950), the only form a PNG IDAT accepts: a raw
 * stream there makes the image undecodable ("broken data stream"), which is
 * what Bedrock Data Automation reported on the first real run.
 */
export function zlibDeflate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(deflateSync(Buffer.from(bytes)));
}

/** Inverse of {@link zlibDeflate}. */
export function zlibInflate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(inflateSync(Buffer.from(bytes)));
}

/** Inverse of {@link deflate}. */
export function inflate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(inflateRawSync(Buffer.from(bytes)));
}

/** Little-endian writer for PNG chunks and ZIP headers. */
export class LeWriter {
  readonly parts: Uint8Array[] = [];

  u8(value: number): this {
    this.parts.push(bytesOf(value));
    return this;
  }

  u16(value: number): this {
    this.parts.push(bytesOf(value & 0xff, (value >>> 8) & 0xff));
    return this;
  }

  u32(value: number): this {
    this.parts.push(bytesOf(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff));
    return this;
  }

  /** Raw bytes appended verbatim. */
  bytes(bytes: Uint8Array): this {
    this.parts.push(bytes);
    return this;
  }

  /** A fixed-width ASCII string, padded (or truncated) with spaces. */
  ascii(value: string, width: number): this {
    this.parts.push(bytesOf(...[...value.padEnd(width)].map((c) => c.charCodeAt(0)).slice(0, width)));
    return this;
  }

  build(): Uint8Array {
    return concatBytes(...this.parts);
  }
}