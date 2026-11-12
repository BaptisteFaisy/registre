/**
 * Minimal deterministic ZIP writer and reader.
 *
 * Single-disk archive, method 8 (raw DEFLATE) for every entry, no encryption and
 * no data descriptor. The DOS timestamp is frozen to 1980-01-01 00:00, so an
 * identical input always yields byte-identical output. CRC-32, DEFLATE and
 * little-endian encoding are all reused from `bits.ts` — nothing low level is
 * re-implemented here.
 *
 * This is the container both OOXML formats (`docx.ts`, `xlsx.ts`) are built on.
 */

import { concatBytes, crc32, deflate, inflate, LeWriter } from './bits.ts';

/** One archive member: its internal path and its uncompressed bytes. */
export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const METHOD_DEFLATE = 8;
const VERSION = 20;
/** Day 1, month 1, year 0 (1980) — the deterministic DOS date. */
const DOS_DATE_1980 = 0x0021;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Builds a ZIP archive from `entries`, in the given order. */
export function zipEntries(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = deflate(entry.bytes);
    const crc = crc32(entry.bytes);
    const local = localHeader(name, data, entry.bytes.length, crc);
    locals.push(local, data);
    centrals.push(centralHeader(name, data, entry.bytes.length, crc, offset));
    offset += local.length + data.length;
  }
  const directory = concatBytes(...centrals);
  return concatBytes(...locals, directory, endRecord(entries.length, directory.length, offset));
}

/** Reads every entry of a ZIP archive into a map keyed by name. */
export function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const end = findEndRecord(bytes);
  const count = readU16(bytes, end + 10);
  const cursor = readU32(bytes, end + 16);
  const out = new Map<string, Uint8Array>();
  let offset = cursor;
  for (let index = 0; index < count; index += 1) {
    offset = readEntry(bytes, offset, out);
  }
  return out;
}

function localHeader(name: Uint8Array, data: Uint8Array, size: number, crc: number): Uint8Array {
  return new LeWriter()
    .u32(LOCAL_SIG)
    .u16(VERSION)
    .u16(0)
    .u16(METHOD_DEFLATE)
    .u16(0)
    .u16(DOS_DATE_1980)
    .u32(crc)
    .u32(data.length)
    .u32(size)
    .u16(name.length)
    .u16(0)
    .bytes(name)
    .build();
}

function centralHeader(
  name: Uint8Array,
  data: Uint8Array,
  size: number,
  crc: number,
  offset: number
): Uint8Array {
  return new LeWriter()
    .u32(CENTRAL_SIG)
    .u16(VERSION)
    .u16(VERSION)
    .u16(0)
    .u16(METHOD_DEFLATE)
    .u16(0)
    .u16(DOS_DATE_1980)
    .u32(crc)
    .u32(data.length)
    .u32(size)
    .u16(name.length)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(0)
    .u32(offset)
    .bytes(name)
    .build();
}

function endRecord(count: number, size: number, offset: number): Uint8Array {
  return new LeWriter()
    .u32(EOCD_SIG)
    .u16(0)
    .u16(0)
    .u16(count)
    .u16(count)
    .u32(size)
    .u32(offset)
    .u16(0)
    .build();
}

/** Reads one central-directory record at `cursor`, returns the next cursor. */
function readEntry(bytes: Uint8Array, cursor: number, out: Map<string, Uint8Array>): number {
  if (readU32(bytes, cursor) !== CENTRAL_SIG) throw new Error('zip: invalid central directory signature');
  const method = readU16(bytes, cursor + 10);
  const crc = readU32(bytes, cursor + 16);
  const compressed = readU32(bytes, cursor + 20);
  const size = readU32(bytes, cursor + 24);
  const nameLen = readU16(bytes, cursor + 28);
  const extraLen = readU16(bytes, cursor + 30);
  const commentLen = readU16(bytes, cursor + 32);
  const localOffset = readU32(bytes, cursor + 42);
  const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
  const data = readData(bytes, localOffset, method, compressed);
  if (crc32(data) !== crc) throw new Error(`zip: CRC-32 mismatch for entry ${name}`);
  if (data.length !== size) throw new Error(`zip: size mismatch for entry ${name}`);
  out.set(name, data);
  return cursor + 46 + nameLen + extraLen + commentLen;
}

function readData(bytes: Uint8Array, offset: number, method: number, length: number): Uint8Array {
  if (readU32(bytes, offset) !== LOCAL_SIG) throw new Error('zip: invalid local file header signature');
  const nameLen = readU16(bytes, offset + 26);
  const extraLen = readU16(bytes, offset + 28);
  const start = offset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + length);
  return method === 0 ? raw.slice() : inflate(raw);
}

function findEndRecord(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (readU32(bytes, index) === EOCD_SIG) return index;
  }
  throw new Error('zip: missing end-of-central-directory record');
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
