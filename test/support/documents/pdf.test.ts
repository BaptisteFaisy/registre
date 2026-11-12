/**
 * Tests of the PDF module (agent A): signature, round-trip on one and three
 * pages, escaping of the PDF literal string, the empty document and the
 * determinism of the bytes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfText, pdfFromText } from '../../../src/support/documents/pdf.ts';

/** One-page evidence, with the header block the scripted reader expects. */
const SAMPLE = [
  '---',
  'Title: Information security policy',
  'Type: Policy',
  'Date: 2026-08-01',
  'Period: 2026-01-01..2026-12-31',
  'Personal data: no',
  'Summary: Annual review approved by the steering committee.',
  '---',
  '',
  '# Information security policy',
  '',
  'Annual review approved by the steering committee.',
  ''
].join('\n');

/** Three pages separated by form feeds, like a real PDF extraction. */
const MULTI_PAGE = [
  'Body of the document, page 1.',
  'A second line of page 1.',
  '\fBody of the document, page 2.',
  '\fBody of the document, page 3.'
].join('');

const EMPTY_PAGE = '\u0028\u0029 Tj';

function asLatin1(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('latin1');
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Cross-reference entries read back from the file, in order. */
function xrefEntries(pdf: Uint8Array): Array<{ offset: number; kind: string }> {
  const raw = asLatin1(pdf);
  const marker = raw.lastIndexOf('startxref');
  const tableStart = Number(raw.slice(marker + 'startxref'.length).trim().split(/\s+/)[0]);
  const entries = [...raw.slice(tableStart).matchAll(/(\d{10}) (\d{5}) ([nf]) /g)];
  return entries.map((entry) => ({ offset: Number(entry[1]), kind: entry[3]! }));
}

test('pdf: the file is a PDF 1.4 document, uncompressed, with Helvetica', () => {
  const pdf = pdfFromText(SAMPLE);
  const raw = asLatin1(pdf);
  assert.ok(raw.startsWith('%PDF-1.4'), 'the signature must open the file');
  assert.ok(raw.endsWith('%%EOF\n'), 'the file must close on the end marker');
  assert.match(raw, /\/Type \/Catalog/);
  assert.match(raw, /\/Subtype \/Type1 \/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.ok(!raw.includes('/FlateDecode'), 'the content streams stay uncompressed');
  assert.equal(countOccurrences(raw, '/Type /Page '), 1, 'one page object');
});

test('pdf: one page round-trips exactly', () => {
  const pdf = pdfFromText(SAMPLE);
  assert.equal(extractPdfText(pdf), SAMPLE);
});

test('pdf: three pages round-trip exactly, joined by a form feed', () => {
  const pdf = pdfFromText(MULTI_PAGE);
  assert.equal(extractPdfText(pdf), MULTI_PAGE);
  assert.equal(countOccurrences(asLatin1(pdf), '/Type /Page '), 3);
  assert.match(asLatin1(pdf), /\/Count 3/);
});

test('pdf: the header lines arrive back exactly', () => {
  const text = extractPdfText(pdfFromText(SAMPLE));
  for (const line of ['Title: Information security policy', 'Type: Policy', 'Date: 2026-08-01',
    'Period: 2026-01-01..2026-12-31', 'Personal data: no']) {
    assert.ok(text.split('\n').includes(line), `"${line}" must survive verbatim`);
  }
  assert.ok(text.startsWith('---\n'), 'the header fence is kept');
});

test('pdf: parentheses and backslashes are escaped and round-trip', () => {
  const text = 'Point of contact: Claire Martin (claire@example.test) \\ path\\to\\file\nSecond (nested) line.';
  const raw = asLatin1(pdfFromText(text));
  assert.ok(raw.includes('\\(claire@example.test\\)'), 'parentheses are escaped');
  assert.ok(raw.includes('\\\\ path\\\\to\\\\file'), 'backslashes are escaped');
  assert.ok(!raw.includes('(Second (nested)'), 'no raw nested parenthesis');
  assert.equal(extractPdfText(pdfFromText(text)), text);
});

test('pdf: an empty text gives one valid empty page', () => {
  const pdf = pdfFromText('');
  const raw = asLatin1(pdf);
  assert.equal(extractPdfText(pdf), '');
  assert.match(raw, /\/Count 1/);
  assert.equal(countOccurrences(raw, '/Type /Page '), 1);
  assert.ok(raw.includes(EMPTY_PAGE), 'the page shows one empty string');
});

test('pdf: two identical calls give identical bytes', () => {
  const first = pdfFromText(SAMPLE);
  const second = pdfFromText(SAMPLE);
  assert.deepEqual(first, second);
  assert.equal(first.length, second.length);
});

test('pdf: a character outside WinAnsi becomes a question mark', () => {
  const text = 'Direction: A \u2192 B, accent e\u0301 kept: \u00e9 \u00e7 \u2014 \u2026';
  const extracted = extractPdfText(pdfFromText(text));
  assert.ok(extracted.includes('A ? B'), 'the arrow is not representable');
  assert.ok(extracted.includes('\u00e9 \u00e7 \u2014 \u2026'), 'accents and CP1252 marks survive');
});

test('pdf: a long line is wrapped at 90 columns and restored on reading', () => {
  const long = 'x'.repeat(200);
  const pdf = pdfFromText(`${long}\nshort`);
  assert.equal(extractPdfText(pdf), `${long}\nshort`);
  // 200 characters split into 90 + 90 + 20, plus the short line: four Tj.
  assert.equal(countOccurrences(asLatin1(pdf), ') Tj'), 4);
});

test('pdf: every cross-reference offset points at its object', () => {
  const pdf = pdfFromText(MULTI_PAGE);
  const raw = asLatin1(pdf);
  const entries = xrefEntries(pdf);
  assert.equal(entries.length, 10, '1 free entry + 9 objects (3 fixed, 3 pages, 3 streams)');
  assert.equal(entries[0]!.kind, 'f');
  entries.slice(1).forEach((entry, index) => {
    assert.equal(entry.kind, 'n');
    assert.match(raw.slice(entry.offset, entry.offset + 16), new RegExp(`^${index + 1} 0 obj`));
  });
});

test('pdf: the declared stream length matches the payload', () => {
  const raw = asLatin1(pdfFromText(SAMPLE));
  for (const match of raw.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = match.index! + match[0].length;
    assert.equal(raw.slice(start, start + Number(match[1])).endsWith('\nET'), true);
  }
});
