/**
 * DOCX writer/reader. Properties checked: the `PK` magic (it is a zip package),
 * exact text round-trip (single line, multiple paragraphs, page break, and a
 * multi-page document with a header), XML escaping of `<`, `&` and `"`, and
 * deterministic bytes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { docxFromText, textFromDocx } from '../../../src/support/documents/docx.ts';
import { unzipEntries } from '../../../src/support/documents/zip.ts';

test('docxFromText emits the PK magic (it is a zip package)', () => {
  const bytes = docxFromText('hello');
  assert.equal(bytes[0], 0x50); // 'P'
  assert.equal(bytes[1], 0x4b); // 'K'
});

test('docx round-trips a single-paragraph text', () => {
  const text = 'Information security policy version 3.1.';
  assert.equal(textFromDocx(docxFromText(text)), text);
});

test('docx round-trips multiple lines as paragraphs', () => {
  const text = 'Title: Policy\nType: Policy\n\nBody line one.\nBody line two.';
  assert.equal(textFromDocx(docxFromText(text)), text);
});

test('docx round-trips a page break (form feed)', () => {
  const text = 'Page one body.\fPage two body.';
  assert.equal(textFromDocx(docxFromText(text)), text);
});

test('docx round-trips a multi-page document with a header block', () => {
  const text = '---\nTitle: Policy\n---\n\nBody page one.\fBody page two.\fBody page three.';
  assert.equal(textFromDocx(docxFromText(text)), text);
});

test('docx round-trips an empty document', () => {
  assert.equal(textFromDocx(docxFromText('')), '');
});

test('docx escapes XML special characters and restores them', () => {
  const text = 'a < b & c "quoted" d';
  assert.equal(textFromDocx(docxFromText(text)), text);
  const part = unzipEntries(docxFromText(text)).get('word/document.xml')!;
  const xml = new TextDecoder().decode(part);
  assert.ok(xml.includes('&lt;'), 'less-than escaped');
  assert.ok(xml.includes('&amp;'), 'ampersand escaped');
  assert.ok(xml.includes('&quot;'), 'double quote escaped');
  assert.ok(!xml.includes('a < b'), 'raw less-than must not survive as text');
});

test('docx is deterministic: identical input yields identical bytes', () => {
  assert.deepEqual(docxFromText('sample'), docxFromText('sample'));
});
