/**
 * Minimal SpreadsheetML (.xlsx) writer and reader, built on the ZIP container.
 *
 * A `.xlsx` is an OPC package holding five parts: `[Content_Types].xml`,
 * `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels` and
 * `xl/worksheets/sheet1.xml`. Every cell is an `inlineStr` (no shared string
 * table), so the sheet is self-contained and the round-trip is exact for
 * CSV-safe content: `rowsFromXlsx(xlsxFromRows(rows))` equals `rows`.
 *
 * The first row is the header; cell order within a row is preserved. Line
 * endings are LF (the reader emits LF and the writer never introduces CR).
 *
 * XML-illegal control characters (including `\f`, `#x0C`) cannot be stored in
 * XML 1.0, so the writer neutralises them to a single space; the round-trip is
 * therefore only guaranteed for CSV-safe content (no control characters).
 * Text nodes reuse the escaping helpers exported by `docx.ts` (no duplication).
 */

import { zipEntries, unzipEntries, type ZipEntry } from './zip.ts';
import { escapeXml, unescapeXml } from './docx.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** XML 1.0 forbids these control/sentinel characters; they cannot be stored. */
const XML_ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF\uD800-\uDFFF]/g;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

/** Builds a real .xlsx archive holding `rows` as inlineStr cells on sheet 1. */
export function xlsxFromRows(rows: readonly (readonly string[])[]): Uint8Array {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', bytes: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: encoder.encode(RELS) },
    { name: 'xl/workbook.xml', bytes: encoder.encode(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', bytes: encoder.encode(sheetXml(rows)) }
  ];
  return zipEntries(entries);
}

/** Extracts every row of sheet 1 back out of an .xlsx archive. */
export function rowsFromXlsx(bytes: Uint8Array): string[][] {
  const parts = unzipEntries(bytes);
  const sheet = parts.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('xlsx: missing xl/worksheets/sheet1.xml');
  return sheetRows(decoder.decode(sheet));
}

function sheetXml(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row, index) => rowXml(row, index + 1)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${body}</sheetData>
</worksheet>`;
}

function rowXml(row: readonly string[], number: number): string {
  const cells = row.map((value) => cellXml(value)).join('');
  return `<row r="${number}">${cells}</row>`;
}

function cellXml(value: string): string {
  return `<c t="inlineStr"><is><t xml:space="preserve">${escapeXml(sanitizeCell(value))}</t></is></c>`;
}

function sanitizeCell(value: string): string {
  return value.replace(XML_ILLEGAL, ' ');
}

function sheetRows(xml: string): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    rows.push(rowCells(row[1]!));
  }
  return rows;
}

function rowCells(rowXml: string): string[] {
  const cells: string[] = [];
  for (const cell of rowXml.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
    cells.push(cellText(cell[1]!));
  }
  return cells;
}

function cellText(cellXml: string): string {
  let out = '';
  for (const match of cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += unescapeXml(match[1]!);
  }
  return out;
}
