/**
 * Row shapes and validators for the four measurement datasets of chapter 13.5.
 *
 * The validators are hand-written (no schema library): the repository has no
 * runtime dependency outside the AWS SDK, and the checks double as the contract
 * the demo generator and the Bedrock tasks must satisfy.
 */

import type { AccessLevel, EvidenceType } from '../../../src/domain/types.ts';
import { ACCESS_ORDER, EVIDENCE_TYPES } from '../../../src/domain/types.ts';
import { isIsoDate } from '../../../src/support/iso8601.ts';

/* --------------------------------------------------------------- file names */

export const DATASET_FILES = {
  reading: 'reading.jsonl',
  attachment: 'attachment.jsonl',
  sufficiency: 'sufficiency.jsonl',
  qa: 'qa.jsonl'
} as const;

export type DatasetName = keyof typeof DATASET_FILES;

export const DATASET_ORDER: readonly DatasetName[] = ['reading', 'attachment', 'sufficiency', 'qa'] as const;

/* -------------------------------------------------------------- row shapes */

export interface ReadingFields {
  type: EvidenceType | null;
  title: string | null;
  documentDate: string | null;
  period: { start: string | null; end: string | null };
  version: string | null;
  author: string | null;
  approver: string | null;
  approvalDate: string | null;
  client: string | null;
  personalData: boolean;
}

export interface ReadingFlags {
  unreadable: boolean;
  missingDate: boolean;
  missingAuthor: boolean;
  dateToConfirm: boolean;
}

/** One line of `reading.jsonl`: the fields a reader must return for a file. */
export interface ReadingRow {
  evidenceId: string;
  fileName: string;
  contentType: string;
  expectedFields: ReadingFields;
  expectedFlags: ReadingFlags;
  expectedAccessLevel: AccessLevel;
  referenceSummary: string;
}

/** One line of `attachment.jsonl`: the controls an evidence must be attached to. */
export interface AttachmentRow {
  evidenceId: string;
  fileName: string;
  expectedControlIds: string[];
  /** True when the correct answer is "supports no control" (R10). */
  mustAttachNone: boolean;
  notes: string;
}

/** One line of `sufficiency.jsonl`: the gaps a reviewer must be told about. */
export interface SufficiencyRow {
  evidenceId: string;
  controlId: string;
  expectedMissing: string[];
  expectedPresent: string[];
  hint: string;
}

/** One line of `qa.jsonl`: the question, its expected evidence and its access. */
export interface QaRow {
  questionId: string;
  question: string;
  expectedAnswerKind: 'EVIDENCE' | 'NO_EVIDENCE';
  expectedEvidenceIds: string[];
  /** Highest access level among the expected evidence; `null` for traps. */
  requiredAccessLevel: AccessLevel | null;
  intent: string;
}

/* -------------------------------------------------------------- primitives */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(row: Record<string, unknown>, keys: readonly string[], problems: string[]): void {
  for (const key of keys) {
    if (!(key in row)) problems.push(`missing field "${key}"`);
  }
}

function checkString(row: Record<string, unknown>, key: string, problems: string[], nullable = false): void {
  const value = row[key];
  if (value === null && nullable) return;
  if (typeof value !== 'string') problems.push(`"${key}" must be a string${nullable ? ' or null' : ''}`);
  else if (value.trim().length === 0) problems.push(`"${key}" must not be empty`);
}

function checkBoolean(row: Record<string, unknown>, key: string, problems: string[]): void {
  if (typeof row[key] !== 'boolean') problems.push(`"${key}" must be a boolean`);
}

function checkStringArray(row: Record<string, unknown>, key: string, problems: string[]): void {
  const value = row[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    problems.push(`"${key}" must be an array of strings`);
    return;
  }
  const unique = new Set(value as string[]);
  if (unique.size !== value.length) problems.push(`"${key}" must not repeat a value`);
}

function checkDate(row: Record<string, unknown>, key: string, problems: string[], nullable = false): void {
  const value = row[key];
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !isIsoDate(value)) {
    problems.push(`"${key}" must be an ISO-8601 date${nullable ? ' or null' : ''}`);
  }
}

function checkAccess(row: Record<string, unknown>, key: string, problems: string[]): void {
  const value = row[key];
  if (typeof value !== 'string' || !ACCESS_ORDER.includes(value as AccessLevel)) {
    problems.push(`"${key}" must be one of ${ACCESS_ORDER.join(', ')}`);
  }
}

/* -------------------------------------------------------------- validators */

function checkPeriod(value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push('"period" must be an object');
    return;
  }
  for (const key of ['start', 'end']) {
    const bound = value[key];
    if (bound === null) continue;
    if (typeof bound !== 'string' || !isIsoDate(bound)) problems.push(`"period.${key}" must be an ISO-8601 date or null`);
  }
  const start = value.start;
  const end = value.end;
  if (typeof start === 'string' && typeof end === 'string' && start > end) {
    problems.push('"period.start" must not be after "period.end"');
  }
}

function checkReadingFields(value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push('"expectedFields" must be an object');
    return;
  }
  checkKeys(
    value,
    ['type', 'title', 'documentDate', 'period', 'version', 'author', 'approver', 'approvalDate', 'client', 'personalData'],
    problems
  );
  const type = value.type;
  if (type !== null && (typeof type !== 'string' || !EVIDENCE_TYPES.includes(type as EvidenceType))) {
    problems.push(`"expectedFields.type" must be one of ${EVIDENCE_TYPES.join(', ')} or null`);
  }
  checkDate(value, 'documentDate', problems, true);
  checkDate(value, 'approvalDate', problems, true);
  for (const key of ['title', 'version', 'author', 'approver', 'client']) checkString(value, key, problems, true);
  checkBoolean(value, 'personalData', problems);
  checkPeriod(value.period, problems);
}

export function validateReadingRow(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['row must be an object'];
  checkKeys(
    value,
    ['evidenceId', 'fileName', 'contentType', 'expectedFields', 'expectedFlags', 'expectedAccessLevel', 'referenceSummary'],
    problems
  );
  checkString(value, 'evidenceId', problems);
  checkString(value, 'fileName', problems);
  checkString(value, 'contentType', problems);
  checkString(value, 'referenceSummary', problems);
  checkAccess(value, 'expectedAccessLevel', problems);
  checkReadingFields(value.expectedFields, problems);
  const flags = value.expectedFlags;
  if (!isRecord(flags)) problems.push('"expectedFlags" must be an object');
  else {
    checkKeys(flags, ['unreadable', 'missingDate', 'missingAuthor', 'dateToConfirm'], problems);
    for (const key of ['unreadable', 'missingDate', 'missingAuthor', 'dateToConfirm']) checkBoolean(flags, key, problems);
  }
  return problems;
}

export function validateAttachmentRow(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['row must be an object'];
  checkKeys(value, ['evidenceId', 'fileName', 'expectedControlIds', 'mustAttachNone', 'notes'], problems);
  checkString(value, 'evidenceId', problems);
  checkString(value, 'fileName', problems);
  checkString(value, 'notes', problems);
  checkStringArray(value, 'expectedControlIds', problems);
  checkBoolean(value, 'mustAttachNone', problems);
  const ids = value.expectedControlIds;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === 'string' && !/^CONT-\d{2}$/.test(id)) problems.push(`"expectedControlIds" entry ${id} is not a control id`);
    }
    if (value.mustAttachNone === true && ids.length > 0) problems.push('"mustAttachNone" requires an empty control list');
    if (value.mustAttachNone === false && ids.length === 0) problems.push('"mustAttachNone" must be true when no control is expected');
  }
  return problems;
}

export function validateSufficiencyRow(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['row must be an object'];
  checkKeys(value, ['evidenceId', 'controlId', 'expectedMissing', 'expectedPresent', 'hint'], problems);
  checkString(value, 'evidenceId', problems);
  checkString(value, 'controlId', problems);
  checkString(value, 'hint', problems);
  checkStringArray(value, 'expectedMissing', problems);
  checkStringArray(value, 'expectedPresent', problems);
  const missing = value.expectedMissing;
  const present = value.expectedPresent;
  if (Array.isArray(missing) && Array.isArray(present)) {
    if (missing.length === 0) problems.push('"expectedMissing" must list at least one gap');
    const overlap = missing.filter((entry) => present.includes(entry));
    if (overlap.length > 0) problems.push(`element both present and missing: ${overlap.join(', ')}`);
  }
  return problems;
}

export function validateQaRow(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['row must be an object'];
  checkKeys(
    value,
    ['questionId', 'question', 'expectedAnswerKind', 'expectedEvidenceIds', 'requiredAccessLevel', 'intent'],
    problems
  );
  checkString(value, 'questionId', problems);
  checkString(value, 'question', problems);
  checkString(value, 'intent', problems);
  checkStringArray(value, 'expectedEvidenceIds', problems);
  const kind = value.expectedAnswerKind;
  if (kind !== 'EVIDENCE' && kind !== 'NO_EVIDENCE') problems.push('"expectedAnswerKind" must be EVIDENCE or NO_EVIDENCE');
  const ids = value.expectedEvidenceIds;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === 'string' && !/^EV-\d{3}$/.test(id)) problems.push(`"expectedEvidenceIds" entry ${id} is not an evidence id`);
    }
    if (kind === 'EVIDENCE' && ids.length === 0) problems.push('an EVIDENCE answer needs at least one expected evidence');
    if (kind === 'NO_EVIDENCE' && ids.length > 0) problems.push('a NO_EVIDENCE answer must not name evidence');
  }
  if (value.requiredAccessLevel === null) {
    if (kind === 'EVIDENCE') problems.push('"requiredAccessLevel" is required when evidence is expected');
  } else {
    checkAccess(value, 'requiredAccessLevel', problems);
  }
  return problems;
}

const VALIDATORS: Record<DatasetName, (value: unknown) => string[]> = {
  reading: validateReadingRow,
  attachment: validateAttachmentRow,
  sufficiency: validateSufficiencyRow,
  qa: validateQaRow
};

/** Validates a whole dataset; returns `<file>:<line>: <problem>` strings. */
export function validateDataset(name: DatasetName, rows: readonly unknown[]): string[] {
  const validate = VALIDATORS[name];
  const problems: string[] = [];
  rows.forEach((row, index) => {
    for (const problem of validate(row)) problems.push(`${DATASET_FILES[name]}:${index + 1}: ${problem}`);
  });
  return problems;
}
