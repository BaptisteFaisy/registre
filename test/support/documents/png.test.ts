/**
 * Tests of the deterministic PNG writer (grayscale 8-bit, color type 0).
 *
 * The PNG is decoded here from scratch (signature, chunk walk, CRC check,
 * inflate, filter-0 scanlines) so the assertions test the real bytes on disk
 * and not a round-trip through the writer's own helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflate } from '../../../src/support/documents/bits.ts';
import { pngFromLines, pngSize } from '../../../src/support/documents/png.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Layout constants mirrored from the module (documented in its header). */
const MARGIN = 2;
const ADVANCE_X = 6;
const LINE_H = 8;
const GLYPH_W = 5;
const GLYPH_H = 7;

interface Chunk {
  type: string;
  data: Uint8Array;
  crc: number;
  crcOk: boolean;
}

interface Decoded {
  width: number;
  height: number;
  /** Raw inflated image data (filter byte + pixels, per scanline). */
  raw: Uint8Array;
  chunks: Chunk[];
}

/** Big-endian 32-bit unsigned read (PNG integers are big-endian). */
function readU32BE(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) value = (value << 8) | (bytes[offset + index] ?? 0);
  return value >>> 0;
}

/** Walks every chunk of a PNG file, checking the CRC of each one. */
function readChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    const crc = readU32BE(bytes, offset + 8 + length);
    const computed = crc32(bytes.slice(offset + 4, offset + 8 + length));
    chunks.push({ type, data, crc, crcOk: crc === computed });
    offset += 12 + length;
  }
  return chunks;
}

/** Decodes a PNG into its header, inflated image data and chunk list. */
function decode(bytes: Uint8Array): Decoded {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  assert.ok(ihdr, 'IHDR chunk missing');
  const idat = chunks.filter((c) => c.type === 'IDAT');
  const raw = inflate(concat(idat.map((c) => c.data)));
  return { width: readU32BE(ihdr.data, 0), height: readU32BE(ihdr.data, 4), raw, chunks };
}

/** Concatenates byte arrays (test-local helper). */
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Returns the pixel value at (x, y) of a decoded filter-0 image. */
function pixelAt(decoded: Decoded, x: number, y: number): number {
  const stride = 1 + decoded.width;
  const rowStart = y * stride;
  assert.equal(decoded.raw[rowStart], 0, 'every scanline must use filter type 0');
  return decoded.raw[rowStart + 1 + x] ?? 255;
}

/**
 * Extracts one 5x7 glyph cell as 7 five-bit rows (bit 4 = leftmost column),
 * so a garbled glyph is caught row by row.
 */
function glyphCell(decoded: Decoded, x0: number, y0: number): number[] {
  const rows: number[] = [];
  for (let r = 0; r < GLYPH_H; r += 1) {
    let value = 0;
    for (let c = 0; c < GLYPH_W; c += 1) {
      if (pixelAt(decoded, x0 + c, y0 + r) === 0) value |= 1 << (GLYPH_W - 1 - c);
    }
    rows.push(value);
  }
  return rows;
}

test('PNG: signature and chunk layout are valid', () => {
  const bytes = pngFromLines(['Hello']);
  assert.deepEqual([...bytes.slice(0, 8)], SIGNATURE);
  const { chunks } = decode(bytes);
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  for (const chunk of chunks) assert.ok(chunk.crcOk, `bad CRC on chunk ${chunk.type}`);
  assert.equal(chunks[2]?.data.length ?? -1, 0, 'IEND must be empty');
});

test('PNG: IHDR describes grayscale 8-bit, no interlace', () => {
  const bytes = pngFromLines(['X']);
  const ihdr = decode(bytes).chunks.find((c) => c.type === 'IHDR');
  assert.ok(ihdr);
  assert.equal(ihdr.data.length, 13, 'IHDR must carry 13 bytes');
  assert.equal(ihdr.data[8], 8, 'bit depth must be 8');
  assert.equal(ihdr.data[9], 0, 'color type must be 0 (grayscale)');
  assert.equal(ihdr.data[10], 0, 'compression must be 0 (deflate)');
  assert.equal(ihdr.data[11], 0, 'filter method must be 0');
  assert.equal(ihdr.data[12], 0, 'interlace must be 0');
});

test('PNG: pngSize matches the IHDR dimensions', () => {
  const lines = ['Title: Northwind', 'Type: EXPORT'];
  const bytes = pngFromLines(lines);
  const decoded = decode(bytes);
  const maxLen = Math.max(...lines.map((l) => l.length));
  assert.deepEqual(pngSize(bytes), { width: decoded.width, height: decoded.height });
  assert.deepEqual(pngSize(bytes), {
    width: maxLen * ADVANCE_X + 2 * MARGIN,
    height: lines.length * LINE_H + 2 * MARGIN,
  });
});

test('PNG: the inflated IDAT holds height * (1 + width) bytes', () => {
  for (const lines of [[], ['A'], ['A', 'BB', 'CCC']]) {
    const bytes = pngFromLines(lines);
    const decoded = decode(bytes);
    assert.equal(decoded.raw.length, decoded.height * (1 + decoded.width));
  }
});

test('PNG: the letter A is rendered field by field', () => {
  const decoded = decode(pngFromLines(['A']));
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11]);
});

test('PNG: the letter B is rendered field by field', () => {
  const decoded = decode(pngFromLines(['B']));
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e]);
});

test('PNG: the digit 1 is rendered field by field', () => {
  const decoded = decode(pngFromLines(['1']));
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e]);
});

test('PNG: several glyphs sit side by side on the same line', () => {
  const decoded = decode(pngFromLines(['AB1']));
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11]);
  assert.deepEqual(glyphCell(decoded, MARGIN + ADVANCE_X, MARGIN), [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e]);
  assert.deepEqual(glyphCell(decoded, MARGIN + 2 * ADVANCE_X, MARGIN), [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e]);
});

test('PNG: an unknown character renders as a filled box', () => {
  const decoded = decode(pngFromLines(['é']));
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f]);
});

test('PNG: the background is white and the text is black', () => {
  const decoded = decode(pngFromLines(['A']));
  assert.equal(pixelAt(decoded, 0, 0), 255, 'outer margin must be white');
  assert.equal(pixelAt(decoded, decoded.width - 1, decoded.height - 1), 255, 'outer margin must be white');
  assert.equal(pixelAt(decoded, MARGIN, MARGIN + 3), 0, 'the crossbar of A must be black');
});

test('PNG: multi-line layout keeps one width and stacks the rows', () => {
  const bytes = pngFromLines(['AB', 'CD']);
  const decoded = decode(bytes);
  assert.equal(decoded.width, 2 * ADVANCE_X + 2 * MARGIN, 'both lines share the same width');
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN), [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11]);
  assert.deepEqual(glyphCell(decoded, MARGIN, MARGIN + LINE_H), [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e]);
});

test('PNG: scale multiplies every pixel', () => {
  const plain = decode(pngFromLines(['A']));
  const scaled = decode(pngFromLines(['A'], 3));
  assert.equal(scaled.width, plain.width * 3);
  assert.equal(scaled.height, plain.height * 3);
  assert.equal(scaled.raw.length, scaled.height * (1 + scaled.width));
  assert.equal(pixelAt(scaled, MARGIN * 3, MARGIN * 3), 255, 'the scaled margin stays white');
  assert.equal(pixelAt(scaled, MARGIN * 3, MARGIN * 3 + 3), 0, 'the scaled crossbar stays black');
});

test('PNG: output bytes are deterministic', () => {
  const lines = ['Title: Northwind', 'Type: EXPORT', 'Personal data: yes'];
  const first = pngFromLines(lines);
  const second = pngFromLines(lines);
  assert.deepEqual([...first], [...second]);
  assert.deepEqual([...pngFromLines(lines, 2)], [...pngFromLines(lines, 2)]);
});

test('PNG: an empty input still yields a valid image', () => {
  const bytes = pngFromLines([]);
  const decoded = decode(bytes);
  assert.ok(decoded.width > 0 && decoded.height > 0);
  assert.equal(decoded.raw.length, decoded.height * (1 + decoded.width));
  assert.deepEqual(pngSize(bytes), { width: decoded.width, height: decoded.height });
});
