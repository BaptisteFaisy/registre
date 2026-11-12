/**
 * Deterministic renderer from a `CatalogueEvidence` entry to its real document.
 *
 * The corpus carries genuine binaries: a PDF with extractable text, real DOCX
 * and XLSX (OOXML in a ZIP), a real PNG for the three screenshots, and CSV for
 * the exports. All of them carry the same structured text, so the offline
 * extractor and Bedrock Data Automation read the same Annex B fields.
 */

import { findControl, findEvidence } from '../../../eval/catalogue.ts';
import type { CatalogueControl, CatalogueEvidence } from '../../../eval/catalogue/types.ts';
import { csvRows } from '../../../src/ai/mock/scriptedReader.ts';
import { docxFromText, mimeTypeOf, pdfFromText, pngFromLines, xlsxFromRows } from '../../../src/support/documents/index.ts';

const SAMPLE_PII_LINES = [
  'Point of contact: Claire Martin (claire.martin@northwind-msp.example, +33 6 12 34 56 78)',
  'Payroll / HR ref: employee 2840107512345 42 — FR76 3000 6000 0112 3456 7890 189'
];

/** Pixel scale of the generated screenshots: 2 keeps 5x7 glyphs readable on screen. */
const PNG_SCALE = 2;

export function renderEvidenceText(evidence: CatalogueEvidence): string {
  const source = resolveSource(evidence);
  if (source.unreadable) return renderUnreadableStub(source);
  return isSpreadsheetExport(source) ? renderCsvDocument(source) : renderStructuredText(source);
}

export const renderEvidence = renderEvidenceText;

/**
 * Bytes of the demonstration document, in the format its file name promises
 * (`.pdf`, `.docx`, `.xlsx`, `.png`, anything else as UTF-8 CSV/text).
 */
export function renderEvidenceBytes(evidence: CatalogueEvidence): Uint8Array {
  const text = renderEvidenceText(evidence);
  switch (extensionOf(evidence.fileName)) {
    case 'pdf':
      return pdfFromText(text);
    case 'docx':
      return docxFromText(text);
    case 'xlsx':
      // A spreadsheet export becomes a real workbook of the same rows; a
      // workbook holding prose keeps one line per row, blank lines included.
      return xlsxFromRows(isSpreadsheetExport(evidence) ? csvRowsOf(text) : proseRowsOf(text));
    case 'png':
      // A screenshot becomes a real image of the same text; the offline reader
      // uses the manifest twin instead of doing OCR. Scale 2 keeps the glyphs
      // legible when the image is shown full screen in the demonstration video.
      return pngFromLines(text.replace(/\n$/, '').split('\n'), PNG_SCALE);
    default:
      return new TextEncoder().encode(text);
  }
}

/** True for the three screenshots, which need an offline text twin. */
export function needsTextTwin(evidence: CatalogueEvidence): boolean {
  return extensionOf(evidence.fileName) === 'png';
}

/**
 * Content type the offline reader must parse: a spreadsheet export is read as
 * rows, everything else as the `Key: value` header format. A workbook holding
 * prose is announced as plain text, because that is what its cells contain.
 */
export function contentTypeOf(evidence: CatalogueEvidence): string {
  if (isSpreadsheetExport(evidence)) return mimeTypeOf(evidence.fileName);
  return extensionOf(evidence.fileName) === 'xlsx' ? 'text/plain' : mimeTypeOf(evidence.fileName);
}

/** Rows of a CSV rendering; the trailing newline is kept as an empty row. */
function csvRowsOf(text: string): string[][] {
  const rows = csvRows(text);
  return text.endsWith('\n') ? [...rows, []] : rows;
}

/** Rows of a prose rendering: one column, one line per row, blank lines kept. */
function proseRowsOf(text: string): string[][] {
  return text.split('\n').map((line) => [line]);
}

function extensionOf(fileName: string): string {
  return fileName.includes('.') ? (fileName.split('.').pop() ?? '').toLowerCase() : '';
}

function resolveSource(evidence: CatalogueEvidence): CatalogueEvidence {
  if (!evidence.duplicateOf) return evidence;
  return findEvidence(evidence.duplicateOf) ?? evidence;
}

export function isSpreadsheetExport(evidence: CatalogueEvidence): boolean {
  return evidence.type === 'EXPORT' || evidence.fileName.toLowerCase().endsWith('.csv');
}

export const isCsvDocument = isSpreadsheetExport;

function renderUnreadableStub(evidence: CatalogueEvidence): string {
  return `Title: ${evidence.title}\n\n[scan: illegible body - no extractable text]`;
}

function renderHeader(evidence: CatalogueEvidence): string[] {
  const printedDate = evidence.seededSituation === 'SCREENSHOT_DATE_TO_CONFIRM'
    ? shiftOneDayBack(evidence.documentDate)
    : evidence.documentDate;
  const lines = [
    '---',
    `Title: ${evidence.title}`,
    `Type: ${evidence.type}`,
    `Date: ${printedDate}`
  ];
  if (evidence.period?.start && evidence.period?.end) {
    lines.push(`Period: ${evidence.period.start}..${evidence.period.end}`);
  }
  if (evidence.version) lines.push(`Version: ${evidence.version}`);
  if (evidence.author) lines.push(`Author: ${evidence.author}`);
  if (evidence.approver) lines.push(`Approved by: ${evidence.approver}`);
  if (evidence.approvalDate) lines.push(`Approval date: ${evidence.approvalDate}`);
  if (evidence.client) lines.push(`Client: ${evidence.client}`);
  lines.push(`Personal data: ${evidence.personalData ? 'yes' : 'no'}`);
  lines.push(`Summary: ${evidence.summary}`);
  lines.push('---');
  return lines;
}

function shiftOneDayBack(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function renderStructuredText(evidence: CatalogueEvidence): string {
  const lines: string[] = [...renderHeader(evidence), ''];
  lines.push(`# ${evidence.title}`, '');
  lines.push(evidence.summary, '');

  const missingSet = new Set(
    evidence.missingElements.map((g) => `${g.controlId}:${g.expected.toLowerCase()}`)
  );

  for (const controlId of evidence.expectedControls) {
    const control = findControl(controlId);
    if (!control) continue;
    lines.push(...renderControlSection(evidence, control, missingSet));
  }

  if (evidence.personalData) {
    lines.push('## Restricted contact details', ...SAMPLE_PII_LINES, '');
  }
  if (evidence.approver) {
    lines.push(`Signed: ${evidence.approver} (${evidence.approvalDate ?? evidence.documentDate})`);
  }
  return `${lines.join('\n')}\n`;
}

function renderControlSection(
  evidence: CatalogueEvidence,
  control: CatalogueControl,
  missingSet: Set<string>
): string[] {
  const out = [
    `## Scope reference — ${control.id}: ${control.title}`,
    `Requirement addressed: ${control.requirement}`,
    ''
  ];
  for (const expected of control.expectedEvidence) {
    if (missingSet.has(`${control.id}:${expected.toLowerCase()}`)) continue;
    // Each element is its own sentence, ending with a full stop: the offline
    // reasoner quotes whole sentences, so a value must be quotable on its own.
    out.push(`- ${expected}: ${withFullStop(elementValue(evidence, expected))}`);
  }
  out.push('');
  return out;
}

function elementValue(evidence: CatalogueEvidence, expected: string): string {
  const lower = expected.toLowerCase();
  if (lower.includes('date')) return evidence.documentDate;
  if (lower.includes('signat') || lower.includes('approv')) {
    return evidence.approver ?? 'verified in meeting record';
  }
  if (lower.includes('version')) return evidence.version ?? '1.0';
  if (lower.includes('client') || lower.includes('customer')) {
    return evidence.client ?? 'Internal managed estate';
  }
  if (lower.includes('period')) {
    return evidence.period?.start && evidence.period?.end
      ? `${evidence.period.start} to ${evidence.period.end}`
      : evidence.documentDate;
  }
  return `Recorded in ${evidence.id} (${evidence.title})`;
}

function renderCsvDocument(evidence: CatalogueEvidence): string {
  const start = evidence.period?.start ?? evidence.documentDate;
  const end = evidence.period?.end ?? evidence.documentDate;
  const mid = midpointDate(start, end);
  const rows = [
    'date,record_id,category,summary,owner,status',
    `${start},${evidence.id}-01,${evidence.type},${csvCell(evidence.title)},${csvCell(evidence.author ?? 'operations')},closed`,
    `${mid},${evidence.id}-02,${evidence.type},${csvCell(evidence.summary)},${csvCell(evidence.author ?? 'operations')},verified`,
    `${end},${evidence.id}-03,${evidence.type},${csvCell(evidence.client ?? 'internal-estate')},${csvCell(evidence.approver ?? 'operations')},completed`
  ];
  return `${rows.join('\n')}\n`;
}

function midpointDate(start: string, end: string): string {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return start;
  return new Date(Math.floor((a + b) / 2)).toISOString().slice(0, 10);
}

/** Ensures a rendered value ends a sentence, so it can be quoted alone. */
function withFullStop(value: string): string {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function csvCell(raw: string): string {
  return raw.replace(/[\r\n,;]+/g, ' ').trim();
}
