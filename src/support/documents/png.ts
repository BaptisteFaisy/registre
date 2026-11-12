/**
 * Deterministic PNG writer — grayscale 8-bit (color type 0), filter type 0 on
 * every scanline, single IDAT (zlib DEFLATE via `bits`), no tIME and no text
 * chunks, so identical input always produces byte-identical output.
 *
 * The renderer draws `lines` as black text on a white background using an
 * embedded public-domain 5x7 bitmap font (ASCII 32..126). Any character outside
 * that range renders as a filled 5x7 box so garbled input stays visible rather
 * than silently blank.
 *
 * Layout constants (documented, picked once, fixed for determinism):
 *   - glyph cell      : 5 columns x 7 rows
 *   - inter-glyph gap : 1 blank column to the right of each glyph (advance = 6)
 *   - baseline margin : 1 blank row below each glyph line (line height = 8)
 *   - outer margin    : 2 px of white on all four sides
 *   - scale           : integer >= 1, each pixel replicated scale x scale
 *
 * Reuses `bits.ts` for CRC-32, DEFLATE and the little-endian writer — this file
 * must not re-implement any of those.
 */

import { bytesOf, concatBytes, crc32, deflate } from './bits.ts';

/** Glyph geometry and layout margins (see module header for the rationale). */
const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_ADVANCE_X = GLYPH_W + 1; // one blank column between glyphs
const LINE_H = GLYPH_H + 1; // 1 px baseline margin under each line
const OUTER_MARGIN = 2; // N px white border on all four sides
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Compact public-domain 5x7 font. One entry per glyph (ASCII 32..126, index =
 * code - 32); each entry is 7 bytes, one per scanline, low 5 bits used: bit 4 is
 * the leftmost column, bit 0 the rightmost. Unknown/missing glyphs fall back to
 * FILLED_BOX (all rows solid). Deterministic: the table is a frozen literal.
 */
const FONT_5X7: readonly string[] = [
  '00000000000000', // 32  
  '04040404040004', // 33 !
  '0a0a0000000000', // 34 "
  '0a0a1f0a1f0a0a', // 35 #
  '040f140e051e04', // 36 $
  '11120409110000', // 37 %
  '0c12140815120d', // 38 &
  '04040000000000', // 39 '
  '02040404040402', // 40 (
  '08040404040408', // 41 )
  '000a041f040a00', // 42 *
  '0004041f040400', // 43 +
  '00000000040408', // 44 ,
  '0000001f000000', // 45 -
  '00000000000404', // 46 .
  '00010204081000', // 47 /
  '0e11131519110e', // 48 0
  '040c040404040e', // 49 1
  '0e11010204081f', // 50 2
  '1f02040201110e', // 51 3
  '02060a121f0202', // 52 4
  '1f101e0101110e', // 53 5
  '0608101e11110e', // 54 6
  '1f010204040404', // 55 7
  '0e11110e11110e', // 56 8
  '0e11110f01020c', // 57 9
  '00040400040400', // 58 :
  '00040400040408', // 59 ;
  '02040810080402', // 60 <
  '00001f001f0000', // 61 =
  '08040201020408', // 62 >
  '0e110102040004', // 63 ?
  '0e11171517100e', // 64 @
  '0e11111f111111', // 65 A
  '1e11111e11111e', // 66 B
  '0e11101010110e', // 67 C
  '1e11111111111e', // 68 D
  '1f10101e10101f', // 69 E
  '1f10101e101010', // 70 F
  '0e11101711110e', // 71 G
  '1111111f111111', // 72 H
  '0e04040404040e', // 73 I
  '0702020202120c', // 74 J
  '11121418141211', // 75 K
  '1010101010101f', // 76 L
  '111b1511111111', // 77 M
  '11191513111111', // 78 N
  '0e11111111110e', // 79 O
  '1e11111e101010', // 80 P
  '0e11111115120d', // 81 Q
  '1e11111e141211', // 82 R
  '0f10100e01011e', // 83 S
  '1f040404040404', // 84 T
  '1111111111110e', // 85 U
  '11111111110a04', // 86 V
  '11111115151b11', // 87 W
  '11110a040a1111', // 88 X
  '11110a04040404', // 89 Y
  '1f01020408101f', // 90 Z
  '0e08080808080e', // 91 [
  '00100804020100', // 92 backslash
  '0e02020202020e', // 93 ]
  '040a1100000000', // 94 ^
  '0000000000001f', // 95 _
  '08040000000000', // 96 `
  '00000e010f110f', // 97 a
  '10101e1111111e', // 98 b
  '00000e1110110e', // 99 c
  '01010f1111110f', // 100 d
  '00000e111f100e', // 101 e
  '0609081e080808', // 102 f
  '00000f11110f01', // 103 g
  '10101e11111111', // 104 h
  '04000c0404040e', // 105 i
  '0200060202120c', // 106 j
  '10101214181412', // 107 k
  '0c04040404040e', // 108 l
  '00001a15151111', // 109 m
  '00001e11111111', // 110 n
  '00000e1111110e', // 111 o
  '00001e11111e10', // 112 p
  '00000f11110f01', // 113 q
  '00001619101010', // 114 r
  '00000f100e011e', // 115 s
  '08081e08080906', // 116 t
  '0000111111130d', // 117 u
  '00001111110a04', // 118 v
  '0000111115150a', // 119 w
  '0000110a040a11', // 120 x
  '00001111110f01', // 121 y
  '00001f0204081f', // 122 z
  '06040408040406', // 123 {
  '04040404040404', // 124 |
  '0c04040204040c', // 125 }
  '00000915120000', // 126 ~
];

/** Fallback for any character without a glyph: a solid 5x7 filled box. */
const FILLED_BOX = '1f1f1f1f1f1f1f';

/**
 * Reads the 7 scanline bytes of one glyph. `code` outside 32..126 (or a missing
 * table entry) returns the filled box. Returns a frozen array of 5-bit rows.
 */
function glyphRows(code: number): readonly number[] {
  const index = code - 32;
  const entry = code >= 32 && code <= 126 ? FONT_5X7[index] : undefined;
  const hex = entry ?? FILLED_BOX;
  const rows: number[] = [];
  for (let i = 0; i < GLYPH_H; i += 1) rows.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return rows;
}

/** True when pixel `col` (0=leftmost) of a 5-bit row value is set. */
function pixelSet(row: number, col: number): boolean {
  return ((row >> (GLYPH_W - 1 - col)) & 1) === 1;
}

interface Bitmap {
  width: number;
  height: number;
  /** Row-major pixel bytes: 0 = black, 255 = white (grayscale 8-bit). */
  pixels: Uint8Array;
}

/** Builds the unscaled pixel grid (white background, black text). */
function renderBitmap(lines: string[]): Bitmap {
  const textW = lines.reduce((max, line) => Math.max(max, line.length * GLYPH_ADVANCE_X), 0);
  const textH = lines.length * LINE_H;
  const width = Math.max(1, textW + 2 * OUTER_MARGIN);
  const height = Math.max(1, textH + 2 * OUTER_MARGIN);
  const pixels = new Uint8Array(width * height).fill(255);
  for (let l = 0; l < lines.length; l += 1) {
    const line = lines[l] ?? '';
    for (let c = 0; c < line.length; c += 1) {
      drawGlyph(pixels, width, line.charCodeAt(c), c, l);
    }
  }
  return { width, height, pixels };
}

/** Paints one glyph's set pixels as black onto `pixels` at cell (col, line). */
function drawGlyph(pixels: Uint8Array, width: number, code: number, col: number, line: number): void {
  const rows = glyphRows(code);
  const x0 = OUTER_MARGIN + col * GLYPH_ADVANCE_X;
  const y0 = OUTER_MARGIN + line * LINE_H;
  for (let r = 0; r < GLYPH_H; r += 1) {
    for (let px = 0; px < GLYPH_W; px += 1) {
      if (!pixelSet(rows[r] ?? 0, px)) continue;
      pixels[(y0 + r) * width + (x0 + px)] = 0;
    }
  }
}

/** Replicates each source pixel into a `scale x scale` block, then adds the
 * filter byte (0) per scanline, yielding the raw PNG image data. */
function toScanlines(bitmap: Bitmap, scale: number): Uint8Array {
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const out = new Uint8Array(height * (1 + width));
  let pos = 0;
  for (let sy = 0; sy < bitmap.height; sy += 1) {
    const row = new Uint8Array(width);
    for (let sx = 0; sx < bitmap.width; sx += 1) {
      const value = bitmap.pixels[sy * bitmap.width + sx] ?? 255;
      for (let k = 0; k < scale; k += 1) row[sx * scale + k] = value;
    }
    for (let k = 0; k < scale; k += 1) {
      out[pos] = 0; // filter type 0 (None)
      out.set(row, pos + 1);
      pos += 1 + width;
    }
  }
  return out;
}

/** The 4 raw bytes of a chunk type string (e.g. "IHDR"). */
function typeBytes(type: string): Uint8Array {
  return bytesOf(...[...type].map((c) => c.charCodeAt(0)));
}

/**
 * Big-endian 32-bit unsigned writer. PNG stores chunk lengths, IHDR dimensions
 * and CRCs big-endian, so `bits.LeWriter` (little-endian, for ZIP) cannot be
 * used here; this builds the bytes from the shared `bytesOf` primitive instead.
 */
function be32(value: number): Uint8Array {
  return bytesOf((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

/** Encodes one PNG chunk: 4-byte length, type, data, CRC over type+data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const tb = typeBytes(type);
  const crc = crc32(concatBytes(tb, data));
  return concatBytes(be32(data.length), tb, data, be32(crc));
}

/** Builds a complete, valid PNG file (grayscale 8-bit) from raw scanlines. */
function buildPng(width: number, height: number, idatData: Uint8Array): Uint8Array {
  // IHDR: width, height, bit depth 8, color type 0, compression 0, filter 0,
  // interlace 0 — the last five are single bytes.
  const ihdr = concatBytes(be32(width), be32(height), bytesOf(8, 0, 0, 0, 0));
  return concatBytes(
    bytesOf(...PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', new Uint8Array(0))
  );
}

/**
 * Renders `lines` as a grayscale PNG. Optional `scale` (integer >= 1) upscales
 * every pixel. Empty input still yields a valid (1x1 minimum) white image.
 */
export function pngFromLines(lines: string[], scale = 1): Uint8Array {
  const factor = Math.max(1, Math.floor(scale));
  const bitmap = renderBitmap(lines);
  const scanlines = toScanlines(bitmap, factor);
  return buildPng(bitmap.width * factor, bitmap.height * factor, deflate(scanlines));
}

/**
 * Reads `{ width, height }` from a PNG's IHDR chunk. Throws on a bad signature
 * or a truncated header so callers cannot silently mis-size an image.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG file: bad signature');
  }
  // IHDR is always the first chunk: 4-byte length + 4-byte type at offset 8.
  if (bytes.length < 24) throw new Error('PNG too short to contain IHDR');
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  return { width, height };
}

/** Big-endian 32-bit unsigned read at `offset` (PNG integers are big-endian). */
function readU32BE(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) value = (value << 8) | (bytes[offset + index] ?? 0);
  return value >>> 0;
}
