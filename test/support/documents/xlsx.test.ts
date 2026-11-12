/**
 * XLSX writer/reader. Properties checked: the `PK` magic, exact round-trip of
 * header + data rows, preserved cell order and empty cells, XML escaping of
 * `<`, `&` and `"`, neutralisation of XML-illegal control characters, and
 * deterministic bytes. Round-trip is guaranteed for CSV-safe content (LF).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { xlsxFromRows, rowsFromXlsx } from '../../../src/support/documents/xlsx.ts';
import { unzipEntries } from '../../../src/support/documents/zip.ts';

test('xlsxFromRows emits the PK magic (it is a zip package)', () => {
  const bytes = xlsxFromRows([['a', 'b']]);
  assert.equal(bytes[0], 0x50); // 'P'
  assert.equal(bytes[1], 0x4b); // 'K'
});

test('xlsx round-trips a header row and data rows', () => {
  const rows = [
    ['date', 'record_id', 'category'],
    ['2026-01-01', 'ev-01', 'policy'],
    ['2026-02-01', 'ev-02', 'report']
  ];
  assert.deepEqual(rowsFromXlsx(xlsxFromRows(rows)), rows);
});

test('xlsx preserves cell order and empty cells', () => {
  const rows = [
    ['a', '', 'c'],
    ['', 'b', '']
  ];
  assert.deepEqual(rowsFromXlsx(xlsxFromRows(rows)), rows);
});

test('xlsx escapes XML special characters and restores them', () => {
  const rows = [['value'], ['a < b & c "quoted"']];
  assert.deepEqual(rowsFromXlsx(xlsxFromRows(rows)), rows);
  const part = unzipEntries(xlsxFromRows(rows)).get('xl/worksheets/sheet1.xml')!;
  const xml = new TextDecoder().decode(part);
  assert.ok(xml.includes('&lt;'), 'less-than escaped');
  assert.ok(xml.includes('&amp;'), 'ampersand escaped');
  assert.ok(xml.includes('&quot;'), 'double quote escaped');
});

test('xlsx neutralises XML-illegal control characters instead of failing', () => {
  const rows = [['a\fb']];
  const out = rowsFromXlsx(xlsxFromRows(rows));
  assert.equal(out.length, 1);
  assert.equal(out[0]![0], 'a b'); // form feed (0x0C) replaced by a space
});

test('xlsx is deterministic: identical input yields identical bytes', () => {
  const rows = [['h1', 'h2'], ['1', '2']];
  assert.deepEqual(xlsxFromRows(rows), xlsxFromRows(rows));
});
