/**
 * Deterministic renderer from a `CatalogueEvidence` entry to text or CSV.
 *
 * Notice on formats: catalogue filenames keep their target extension (`.pdf`,
 * `.docx`, `.xlsx`, `.png`), but the offline demo stores a structured UTF-8
 * rendering so the reader needs no binary parser.
 */

import { findControl, findEvidence } from '../../../eval/catalogue.ts';
import type { CatalogueControl, CatalogueEvidence } from '../../../eval/catalogue/types.ts';

const SAMPLE_PII_LINES = [
  'Point of contact: Claire Martin (claire.martin@northwind-msp.example, +33 6 12 34 56 78)',
  'Payroll / HR ref: employee 2840107512345 42 — FR76 3000 6000 0112 3456 7890 189'
];

export function renderEvidenceText(evidence: CatalogueEvidence): string {
  const source = resolveSource(evidence);
  if (source.unreadable) return renderUnreadableStub(source);
  return isSpreadsheetExport(source) ? renderCsvDocument(source) : renderStructuredText(source);
}

export const renderEvidence = renderEvidenceText;

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
