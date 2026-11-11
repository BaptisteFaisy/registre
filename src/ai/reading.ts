/**
 * Shared reading rules used by BOTH readers (Bedrock Data Automation and the
 * scripted mock), so the offline demo and the AWS deployment derive the same
 * access level and the same read flags from the same fields (no duplication).
 *
 * Everything here is pure and computed by code (ENF-IA-04, EF-LEC-03/04).
 */

import type {
  AccessLevel,
  EvidenceFields,
  EvidencePeriod,
  EvidenceType,
  ReadFlags,
  TextPage
} from '../domain/types.ts';
import { EVIDENCE_TYPES } from '../domain/types.ts';
import { isIsoDate, toDateOnly } from '../support/iso8601.ts';
import { sentences } from '../support/normalize.ts';

/** Characters below which a document is considered unreadable (EF-LEC-04). */
export const MIN_READABLE_CHARS = 40;

/** Type synonyms found in real documents, mapped to the closed list. */
const TYPE_SYNONYMS: Readonly<Record<string, EvidenceType>> = {
  policy: 'POLICY',
  policies: 'POLICY',
  charte: 'POLICY',
  politique: 'POLICY',
  procedure: 'PROCEDURE',
  process: 'PROCEDURE',
  procedure_operationnelle: 'PROCEDURE',
  minutes: 'MINUTES',
  meeting: 'MINUTES',
  'compte rendu': 'MINUTES',
  'compte-rendu': 'MINUTES',
  report: 'REPORT',
  rapport: 'REPORT',
  export: 'EXPORT',
  extract: 'EXPORT',
  screenshot: 'SCREENSHOT',
  'capture ecran': 'SCREENSHOT',
  'capture d ecran': 'SCREENSHOT',
  list: 'LIST',
  liste: 'LIST',
  register: 'LIST',
  registre: 'LIST',
  attestation: 'ATTESTATION',
  certificate: 'ATTESTATION',
  certificat: 'ATTESTATION',
  statement: 'ATTESTATION'
};

/** Maps a free-text document class to the closed list, or null (EF-LEC-01). */
export function normaliseEvidenceType(value: string | null | undefined): EvidenceType | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const direct = EVIDENCE_TYPES.find((type) => type.toLowerCase() === key);
  if (direct) return direct;
  return TYPE_SYNONYMS[key] ?? null;
}

/** Keeps a date only when it is ISO-8601, otherwise null. */
export function safeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return isIsoDate(value) ? toDateOnly(value) : null;
}

/** Builds a period, dropping an end before the start (data entry error). */
export function buildPeriod(start: string | null | undefined, end: string | null | undefined): EvidencePeriod {
  const from = safeDate(start);
  const to = safeDate(end);
  if (from && to && to < from) return { start: from, end: from };
  return { start: from, end: to };
}

/**
 * Access level of an evidence (ENF-CONF-01, EF-LEC-03).
 * Personal data or a named customer forces RESTRICTED; the reader never
 * downgrades a level, only the human can widen access afterwards.
 */
export function inferAccessLevel(fields: Pick<EvidenceFields, 'personalData' | 'client'>): AccessLevel {
  return fields.personalData || fields.client ? 'RESTRICTED' : 'INTERNAL';
}

/** Flags that force a human review (EF-LEC-04). */
export function buildReadFlags(input: {
  fields: EvidenceFields;
  text: string;
  fileDate?: string | null;
}): ReadFlags {
  const { fields, text, fileDate } = input;
  const documentDate = fields.documentDate;
  return {
    unreadable: text.trim().length < MIN_READABLE_CHARS,
    missingDate: !documentDate,
    missingAuthor: !fields.author && !fields.approver,
    dateToConfirm: Boolean(fileDate && documentDate && fileDate !== documentDate)
  };
}

/** Page separator recognised in extracted text (form feed, common in PDFs). */
const PAGE_BREAK = '\f';

/**
 * Splits extracted text into pages (EF-LEC-02).
 * Page numbers are 1-based; an empty document still yields one empty page so
 * the caller can detect the unreadable case instead of crashing.
 */
export function splitPages(text: string): TextPage[] {
  const parts = text.split(PAGE_BREAK);
  if (parts.length <= 1) return [{ page: 1, text }];
  return parts.map((part, index) => ({ page: index + 1, text: part }));
}

/** Joins every page back into one text (quote verification, prompts). */
export function joinPages(pages: readonly TextPage[]): string {
  return pages.map((page) => page.text).join('\n');
}

/**
 * First `count` sentences of a text, used when no summary was extracted
 * (Annex B: at most three sentences). Reuses the shared splitter.
 */
export function summarise(text: string, count = 3): string | null {
  const parts = sentences(text.replace(/\s+/g, ' '));
  if (parts.length === 0) return null;
  return parts.slice(0, count).join(' ');
}
