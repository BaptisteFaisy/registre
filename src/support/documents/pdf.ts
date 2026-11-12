/**
 * Real PDF 1.4 documents for the demonstration vault (binary module, agent A).
 *
 * `pdfFromText` turns a plain-text evidence into a valid PDF — one page per
 * form-feed separated page — and `extractPdfText` reads those bytes back into
 * the very same text, so the offline reader keeps producing identical fields
 * while the vault now holds real documents.
 *
 * Design notes
 * - Base-14 Helvetica with WinAnsiEncoding (CP1252); the content streams are
 *   UNCOMPRESSED (no /FlateDecode), which keeps the extractor trivial and the
 *   bytes inspectable.
 * - A text line is shown with one `Tj` operator on its own baseline. A line
 *   longer than `WRAP_COLUMNS` characters is split into several `Tj`
 *   operators that share the same baseline; the reader joins them back, so
 *   writer and reader agree on the split and the original line is restored.
 * - Lines are separated by LF and pages by a form feed (`\f`), exactly what
 *   the scripted reader expects.
 * - The bytes are deterministic: no clock, no random id, a fixed `/ID`.
 */

import { concatBytes } from './bits.ts';

/* ------------------------------------------------------------- constants */

/** US Letter page, in points. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** Left margin, first baseline, font size and line spacing, in points. */
const MARGIN_X = 54;
const TOP_Y = 756;
const FONT_SIZE = 9;
const LINE_LEADING = 11;

/** A text line longer than this is split into several `Tj` operators. */
const WRAP_COLUMNS = 90;

/** Fixed document id: the bytes must not depend on a clock or a random draw. */
const DOCUMENT_ID = '0123456789abcdef0123456789abcdef';

/** Question mark replaces every character WinAnsi cannot encode. */
const FALLBACK_BYTE = 0x3f;

/** Object number of the first page (1 catalog, 2 page tree, 3 font). */
const FIRST_PAGE_OBJECT = 4;

/**
 * Unicode code points of the CP1252 bytes 0x80..0x9F, the only range where
 * WinAnsiEncoding differs from Latin-1. Every other byte maps to itself.
 */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x017e, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
];

/** Unicode code point -> WinAnsi byte (first match wins, so it stays stable). */
const WINANSI_TO_BYTE: ReadonlyMap<number, number> = buildWinAnsiMap();

/* ------------------------------------------------------------- encoding */

function buildWinAnsiMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (let byte = 0x20; byte <= 0x7e; byte += 1) map.set(byte, byte);
  map.set(0x09, 0x09);
  for (let byte = 0xa0; byte <= 0xff; byte += 1) map.set(byte, byte);
  CP1252_HIGH.forEach((codePoint, index) => {
    const byte = 0x80 + index;
    if (!map.has(codePoint)) map.set(codePoint, byte);
  });
  return map;
}

/** Unicode code point of a WinAnsi byte. */
function winAnsiCodePoint(byte: number): number {
  return byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80]! : byte;
}

/** Decodes WinAnsi bytes (as a latin1 string) back into Unicode text. */
function decodeWinAnsi(raw: string): string {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    out += String.fromCodePoint(winAnsiCodePoint(raw.charCodeAt(index)));
  }
  return out;
}

/** Encodes a text as a PDF literal string body, escaping `(`, `)` and `\`. */
function pdfString(text: string): string {
  let out = '';
  for (const character of text) {
    const byte = WINANSI_TO_BYTE.get(character.codePointAt(0)!) ?? FALLBACK_BYTE;
    if (byte === 0x5c) out += '\\\\';
    else if (byte === 0x28) out += '\\(';
    else if (byte === 0x29) out += '\\)';
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** Splits a long line into the chunks shown by one `Tj` operator each. */
function chunkLine(line: string): string[] {
  const characters = Array.from(line);
  if (characters.length <= WRAP_COLUMNS) return [line];
  const chunks: string[] = [];
  for (let start = 0; start < characters.length; start += WRAP_COLUMNS) {
    chunks.push(characters.slice(start, start + WRAP_COLUMNS).join(''));
  }
  return chunks;
}

/* --------------------------------------------------------------- writing */

/** Converts a latin1 string (one char per byte) into bytes. */
function latin1Bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

/** Content stream of one page: one `Tj` per line, on its own baseline. */
function pageContentStream(lines: string[]): string {
  const parts: string[] = ['BT', `/F1 ${FONT_SIZE} Tf`, `${MARGIN_X} ${TOP_Y} Td`];
  lines.forEach((line, index) => {
    if (index > 0) parts.push(`0 ${-LINE_LEADING} Td`);
    for (const chunk of chunkLine(line)) parts.push(`(${pdfString(chunk)}) Tj`);
  });
  parts.push('ET');
  return parts.join('\n');
}

/** Assembles the indirect objects of the document, in numbering order. */
function buildObjects(pages: string[][]): string[] {
  const kids = pages.map((_, index) => `${FIRST_PAGE_OBJECT + 2 * index} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  pages.forEach((lines, index) => {
    const contentObject = FIRST_PAGE_OBJECT + 2 * index + 1;
    const page = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`
      + ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
    const content = pageContentStream(lines);
    objects.push(page);
    objects.push(`<< /Length ${latin1Bytes(content).length} >>\nstream\n${content}\nendstream`);
  });
  return objects;
}

/** Serialises the objects, the cross-reference table and the trailer. */
function buildPdf(pages: string[][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (chunk: string): void => {
    const bytes = latin1Bytes(chunk);
    parts.push(bytes);
    size += bytes.length;
  };
  push('%PDF-1.4\n');
  push('\u00e2\u00e3\u00cf\u00d3\n');
  buildObjects(pages).forEach((object, index) => {
    offsets.push(size);
    push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = size;
  push(`xref\n0 ${offsets.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R`
    + ` /ID [<${DOCUMENT_ID}> <${DOCUMENT_ID}>] >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF\n`);
  return concatBytes(...parts);
}

/** Builds a valid PDF from the text of an evidence (LF lines, `\f` pages). */
export function pdfFromText(text: string): Uint8Array {
  const normalised = text.replace(/\r\n/g, '\n');
  const pages = normalised.split('\f').map((page) => page.split('\n'));
  return buildPdf(pages);
}

/* --------------------------------------------------------------- reading */

interface ObjectRange {
  start: number;
  end: number;
}

/** Locates every indirect object of the file (streams are skipped). */
function objectOffsets(raw: string): Map<number, ObjectRange> {
  const map = new Map<number, ObjectRange>();
  const pattern = /(?:^|\n)(\d+) 0 obj\b/g;
  let skipped = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    if (match.index < skipped) continue;
    const start = match.index + match[0].length;
    const end = objectEnd(raw, start);
    map.set(Number(match[1]), { start, end });
    skipped = end;
  }
  return map;
}

/** End offset of the object starting at `start` (its `endobj` keyword). */
function objectEnd(raw: string, start: number): number {
  const streamAt = raw.indexOf('stream', start);
  const endObjAt = raw.indexOf('endobj', start);
  if (streamAt === -1 || (endObjAt !== -1 && endObjAt < streamAt)) {
    return endObjAt === -1 ? raw.length : endObjAt;
  }
  const length = Number(/\/Length\s+(\d+)/.exec(raw.slice(start, streamAt))?.[1] ?? '0');
  const after = raw.indexOf('endobj', streamEnd(raw, streamAt) + length);
  return after === -1 ? raw.length : after;
}

/** First byte of the payload of a stream (the `stream` keyword is skipped). */
function streamEnd(raw: string, streamAt: number): number {
  let start = streamAt + 'stream'.length;
  if (raw[start] === '\r') start += 1;
  if (raw[start] === '\n') start += 1;
  return start;
}

/** Payload of a content stream, read through its declared /Length. */
function streamPayload(raw: string, range: ObjectRange): string {
  const body = raw.slice(range.start, range.end);
  const marker = body.indexOf('stream');
  if (marker === -1) return '';
  const length = Number(/\/Length\s+(\d+)/.exec(body.slice(0, marker))?.[1] ?? '0');
  return raw.slice(streamEnd(raw, range.start + marker), streamEnd(raw, range.start + marker) + length);
}

/** Collects the page objects of the page tree, in document order. */
function collectPages(raw: string, objects: Map<number, ObjectRange>, number: number, out: number[]): void {
  const range = objects.get(number);
  if (!range) return;
  const body = raw.slice(range.start, range.end);
  if (!/\/Type\s*\/Pages/.test(body)) {
    out.push(number);
    return;
  }
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body);
  if (!kids) return;
  for (const match of kids[1]!.matchAll(/(\d+)\s+0\s+R/g)) {
    collectPages(raw, objects, Number(match[1]), out);
  }
}

/** Page objects of the document, read from the catalog and the page tree. */
function pageObjectNumbers(raw: string, objects: Map<number, ObjectRange>): number[] {
  const root = /\/Root\s+(\d+)\s+0\s+R/.exec(raw);
  if (!root) return [];
  const catalog = objects.get(Number(root[1]));
  if (!catalog) return [];
  const pages = /\/Pages\s+(\d+)\s+0\s+R/.exec(raw.slice(catalog.start, catalog.end));
  if (!pages) return [];
  const out: number[] = [];
  collectPages(raw, objects, Number(pages[1]), out);
  return out;
}

/** Text of one page: its content stream decoded line by line. */
function pageText(raw: string, objects: Map<number, ObjectRange>, number: number): string {
  const range = objects.get(number);
  if (!range) return '';
  const reference = /\/Contents\s+(\d+)\s+0\s+R/.exec(raw.slice(range.start, range.end));
  if (!reference) return '';
  const content = objects.get(Number(reference[1]));
  if (!content) return '';
  return parseStreamLines(streamPayload(raw, content)).map(decodeWinAnsi).join('\n');
}

/** Reads the text back from a PDF produced by {@link pdfFromText}. */
export function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const objects = objectOffsets(raw);
  return pageObjectNumbers(raw, objects)
    .map((number) => pageText(raw, objects, number))
    .join('\f');
}

/* ------------------------------------------------------- content streams */

interface ContentToken {
  kind: 'string' | 'number' | 'name' | 'operator';
  value: string;
}

function isLetter(character: string): boolean {
  return (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isNumberStart(character: string): boolean {
  return (character >= '0' && character <= '9') || character === '+' || character === '-' || character === '.';
}

function isDelimiter(character: string): boolean {
  return ' \t\r\n\f\0()<>[]{}/%'.includes(character);
}

/** Reads a literal string `(...)`, honouring the escapes and the nesting. */
function readLiteralString(stream: string, start: number): { value: string; next: number } {
  let index = start + 1;
  let depth = 1;
  let out = '';
  while (index < stream.length) {
    const character = stream[index]!;
    if (character === '\\') {
      const escaped = stream[index + 1];
      if (escaped === undefined) break;
      const octal = /^[0-7]{1,3}/.exec(stream.slice(index + 1));
      if (octal) {
        out += String.fromCharCode(parseInt(octal[0], 8));
        index += 1 + octal[0].length;
        continue;
      }
      out += ESCAPED_CHARACTERS[escaped] ?? escaped;
      index += 2;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
    out += character;
    index += 1;
  }
  return { value: out, next: index };
}

/** The few PDF escapes that stand for a character rather than for itself. */
const ESCAPED_CHARACTERS: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f'
};

/** Splits a content stream into strings, numbers, names and operators. */
function tokenizeContent(stream: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  let index = 0;
  while (index < stream.length) {
    const character = stream[index]!;
    if (character === '%') {
      const end = stream.indexOf('\n', index);
      index = end === -1 ? stream.length : end + 1;
      continue;
    }
    if (character === '(') {
      const read = readLiteralString(stream, index);
      tokens.push({ kind: 'string', value: read.value });
      index = read.next;
      continue;
    }
    if (character === '/') {
      let end = index + 1;
      while (end < stream.length && !isDelimiter(stream[end]!)) end += 1;
      tokens.push({ kind: 'name', value: stream.slice(index + 1, end) });
      index = end;
      continue;
    }
    if (isNumberStart(character)) {
      let end = index;
      while (end < stream.length && /[0-9+\-.]/.test(stream[end]!)) end += 1;
      tokens.push({ kind: 'number', value: stream.slice(index, end) });
      index = end;
      continue;
    }
    if (isLetter(character)) {
      let end = index;
      while (end < stream.length && isLetter(stream[end]!)) end += 1;
      tokens.push({ kind: 'operator', value: stream.slice(index, end) });
      index = end;
      continue;
    }
    index += 1;
  }
  return tokens;
}

/** Lines of a content stream: one per baseline, chunks of a line joined. */
function parseStreamLines(stream: string): string[] {
  const tokens = tokenizeContent(stream);
  const lines: string[] = [];
  let chunks: string[] = [];
  let operands: string[] = [];
  let pending: string | null = null;
  let baseline: number | null = null;
  let leading = 0;
  const flush = (): void => {
    lines.push(chunks.join(''));
    chunks = [];
  };
  for (const token of tokens) {
    if (token.kind !== 'operator') {
      if (token.kind === 'string') pending = token.value;
      operands.push(token.value);
      continue;
    }
    const last = Number(operands[operands.length - 1] ?? '0');
    if (token.value === 'BT') {
      chunks = [];
      pending = null;
      baseline = null;
    } else if (token.value === 'ET') {
      flush();
    } else if (token.value === 'TL') {
      leading = last;
    } else if (token.value === 'Td' || token.value === 'TD') {
      if (baseline === null) baseline = last;
      else if (last !== 0) {
        flush();
        baseline += last;
      }
    } else if (token.value === 'T*') {
      flush();
      baseline = (baseline ?? 0) - leading;
    } else if (token.value === 'Tm') {
      if (baseline !== null && last !== baseline) flush();
      baseline = last;
    } else if (token.value === 'Tj' || token.value === "'" || token.value === '"') {
      if (pending !== null) chunks.push(pending);
      pending = null;
    }
    operands = [];
  }
  return lines;
}
