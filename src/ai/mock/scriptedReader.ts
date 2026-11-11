/**
 * Scripted `EvidenceReader` — the deterministic twin of Bedrock Data Automation
 * (EF-LEC-01..04), used by the tests, the offline demo and the backup video.
 *
 * EXPECTED FILE FORMAT (text, markdown and CSV)
 *
 * A text or markdown evidence starts with a header block of `Key: value` lines,
 * optionally fenced by `---`; the body follows after the first blank line.
 *
 *   ---
 *   Title: Information security policy
 *   Type: Policy
 *   Date: 2026-08-01
 *   Period: 2026-01-01..2026-12-31
 *   Version: 3.1
 *   Author: A. Dupont
 *   Approved by: C. Bernard
 *   Approval date: 2026-08-05
 *   Client: Acme Corp
 *   Personal data: no
 *   Summary: Annual review approved by the steering committee.
 *   ---
 *   Body of the document, page 1.
 *   \f
 *   Body of the document, page 2.
 *
 * Recognised keys (case and spacing insensitive): title, type, date, period,
 * period start, period end, version, author, approved by / approver,
 * approval date, client, personal data, summary.
 *
 * A CSV evidence is a spreadsheet export: the first row is the header, and the
 * covered period is computed by code from the date column (spec 13.1: "the
 * period is deduced from the row dates by code").
 *
 * Page breaks are form feeds (`\f`), exactly what the real reader produces.
 */

import type { CostMeter, EvidenceReader, ReadInput, ReadResult } from '../../ports/index.ts';
import type { EvidenceFields, EvidencePeriod } from '../../domain/types.ts';
import { unreadable } from '../../support/errors.ts';
import { readFileSync } from 'node:fs';
import { buildPeriod, buildReadFlags, inferAccessLevel, joinPages, normaliseEvidenceType, safeDate, splitPages, summarise } from '../reading.ts';
import { readingCost, recordCost } from '../bedrock/costs.ts';

/** Header keys of the text format, mapped to the Annex B field. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  title: 'title',
  type: 'type',
  'evidence type': 'type',
  date: 'documentDate',
  'document date': 'documentDate',
  period: 'period',
  'period start': 'periodStart',
  'period end': 'periodEnd',
  version: 'version',
  author: 'author',
  'approved by': 'approver',
  approver: 'approver',
  signatory: 'approver',
  'approval date': 'approvalDate',
  client: 'client',
  customer: 'client',
  'personal data': 'personalData',
  summary: 'summary'
};

/** True for a truthy header value ("yes", "true", "oui", "1"). */
export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  return /^(y|yes|true|1|oui|vrai)$/i.test(value.trim());
}

/** Splits a `Key: value` line into its normalised key and its raw value. */
export function headerLine(line: string): { key: string; value: string } | null {
  const match = /^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z /_-]{1,40})\s*:\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const key = KEY_ALIASES[match[1]!.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()];
  return key ? { key, value: match[2]! } : null;
}

/** Splits a text evidence into its header map and its body. */
export function splitHeader(text: string): { headers: Record<string, string>; body: string } {
  const lines = text.split('\n');
  const headers: Record<string, string> = {};
  let index = 0;
  let inHeader = true;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (inHeader && /^\s*-{3,}\s*$/.test(line)) {
      inHeader = false;
      continue;
    }
    if (line.trim().length === 0) {
      if (Object.keys(headers).length > 0) break;
      continue;
    }
    const parsed = headerLine(line);
    if (!parsed) break;
    headers[parsed.key] = parsed.value;
  }
  return { headers, body: lines.slice(index).join('\n').trim() };
}

/** Reads `start..end` or `start - end` from a period header. */
export function parsePeriod(value: string | undefined): EvidencePeriod {
  if (!value) return { start: null, end: null };
  const parts = value.split(/\.\.|->|–|\bto\b/i).map((part) => part.trim());
  return buildPeriod(parts[0] ?? null, parts[1] ?? null);
}

/** Builds the Annex B fields from the header map. */
export function fieldsFromHeaders(headers: Record<string, string>, body: string): EvidenceFields {
  const period = headers.period ? parsePeriod(headers.period) : buildPeriod(headers.periodStart, headers.periodEnd);
  return {
    type: normaliseEvidenceType(headers.type ?? null),
    title: headers.title ?? null,
    documentDate: safeDate(headers.documentDate),
    period,
    version: headers.version ?? null,
    author: headers.author ?? null,
    approver: headers.approver ?? null,
    approvalDate: safeDate(headers.approvalDate),
    client: headers.client ?? null,
    summary: headers.summary ?? summarise(body),
    personalData: isTruthyFlag(headers.personalData)
  };
}

/** Minimal CSV splitter (no quoted-comma support: exports are flat). */
export function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(line.includes(';') ? ';' : ',').map((cell) => cell.trim()));
}

/** Column index of the first matching header name, or -1. */
function columnIndex(header: string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(cell.toLowerCase().replace(/[\s_-]+/g, ' ')));
}

/** Fields of a CSV export: dates are aggregated into the covered period. */
export function fieldsFromCsv(text: string): EvidenceFields {
  const rows = csvRows(text);
  const header = (rows[0] ?? []).map((cell) => cell.toLowerCase().replace(/[\s_-]+/g, ' '));
  const dateIndex = columnIndex(header, ['date', 'date evenement', 'event date', 'opened at', 'created']);
  const dates = rows
    .slice(1)
    .map((row) => (dateIndex >= 0 ? safeDate(row[dateIndex] ?? null) : null))
    .filter((value): value is string => Boolean(value))
    .sort();
  const period = buildPeriod(dates[0] ?? null, dates[dates.length - 1] ?? null);
  return {
    type: 'EXPORT',
    title: header.length > 0 ? `Export (${rows.length - 1} rows)` : null,
    documentDate: period.end,
    period,
    version: null,
    author: null,
    approver: null,
    approvalDate: null,
    client: null,
    summary: summarise(text.replace(/[;\n]+/g, '. ')),
    personalData: false
  };
}

export interface ScriptedReaderOptions {
  /** Reader id reported in `Evidence.reader` and in the cost record. */
  id?: string;
  /** Overrides the content type sniffing (tests). */
  contentType?: string;
  /** Shared meter; the reading cost is recorded there (ENF-COUT-01). */
  meter?: CostMeter;
}

/**
 * Reads a text, markdown or CSV evidence by deterministic rules (EF-LEC-01).
 * Bytes come from `ReadInput.bytes` when present, otherwise from a local file.
 */
export class ScriptedReader implements EvidenceReader {
  readonly id = 'mock-scripted-reader';
  private readonly options: ScriptedReaderOptions;

  constructor(options: ScriptedReaderOptions = {}) {
    this.options = options;
  }

  async read(input: ReadInput): Promise<ReadResult> {
    const text = this.loadText(input);
    const contentType = this.options.contentType ?? input.contentType;
    const csv = isCsv(contentType);
    const { headers, body } = splitHeader(text);
    const fields = csv ? fieldsFromCsv(text) : fieldsFromHeaders(headers, body);
    const textPages = splitPages(csv ? text : body);
    const accessLevel = inferAccessLevel(fields);
    const flags = buildReadFlags({ fields, text: joinPages(textPages), fileDate: input.fileDate ?? null });
    if (flags.unreadable) console.warn(`${this.id}: ${input.evidenceId} looks unreadable (${text.length} chars)`);
    const cost = recordCost(
      this.options.meter,
      readingCost(this.options.id ?? this.id, textPages.length)
    );
    return { fields, flags, textPages, accessLevel, cost };
  }

  /** Reads the raw text from bytes or from a local file URI. */
  private loadText(input: ReadInput): string {
    if (input.bytes) return new TextDecoder().decode(input.bytes);
    const path = input.uri.replace(/^file:\/\//, '');
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw unreadable(`scripted reader cannot open ${input.uri}: ${(error as Error).message}`, {
        evidenceId: input.evidenceId
      });
    }
  }
}

function isCsv(contentType: string): boolean {
  return /csv|spreadsheet|excel/i.test(contentType);
}

/** Factory used by `createMockAi` (EF-LEC-01). */
export function createScriptedReader(options: ScriptedReaderOptions = {}): EvidenceReader {
  return new ScriptedReader(options);
}
