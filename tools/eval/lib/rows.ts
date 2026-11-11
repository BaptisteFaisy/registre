/**
 * Builds the four datasets of chapter 13.5 from the catalogue.
 *
 * One implementation, reused by `buildDatasets.ts` (writes the files) and by the
 * test suite (validates them without touching the disk).
 */

import type { AccessLevel } from '../../../src/domain/types.ts';
import { ACCESS_ORDER } from '../../../src/domain/types.ts';
import { excerpt } from '../../../src/support/normalize.ts';
import type { CatalogueEvidence } from '../../../eval/catalogue.ts';
import { EVIDENCE, QUESTIONS, findControl, findEvidence, incompleteEvidence } from '../../../eval/catalogue.ts';
import type { AttachmentRow, QaRow, ReadingFields, ReadingFlags, ReadingRow, SufficiencyRow } from './schema.ts';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png'
};

/** MIME type derived from the file extension; `octet-stream` when unknown. */
export function contentTypeOf(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  const extension = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function emptyFields(): ReadingFields {
  return {
    type: null,
    title: null,
    documentDate: null,
    period: { start: null, end: null },
    version: null,
    author: null,
    approver: null,
    approvalDate: null,
    client: null,
    personalData: false
  };
}

function readingFields(item: CatalogueEvidence): ReadingFields {
  if (item.unreadable) return emptyFields();
  return {
    type: item.type,
    title: item.title,
    documentDate: item.documentDate,
    period: item.period ?? { start: null, end: null },
    version: item.version,
    author: item.author,
    approver: item.approver,
    approvalDate: item.approvalDate,
    client: item.client,
    personalData: item.personalData
  };
}

function readingFlags(item: CatalogueEvidence): ReadingFlags {
  return {
    unreadable: item.unreadable,
    missingDate: item.unreadable ? false : item.documentDate.length === 0,
    missingAuthor: item.unreadable ? false : item.author === null,
    dateToConfirm: item.dateToConfirm
  };
}

function readingRow(item: CatalogueEvidence): ReadingRow {
  return {
    evidenceId: item.id,
    fileName: item.fileName,
    contentType: contentTypeOf(item.fileName),
    expectedFields: readingFields(item),
    expectedFlags: readingFlags(item),
    expectedAccessLevel: item.accessLevel,
    referenceSummary: item.summary
  };
}

function attachmentNotes(item: CatalogueEvidence): string {
  if (item.expectedControls.length === 0) return 'Supports no control of the framework (R10).';
  if (item.duplicateOf !== null) return `Duplicate of ${item.duplicateOf}: same content under another name (R8).`;
  if (item.seededSituation === 'MISFILED_EVIDENCE') {
    return `Filed under ${item.filedUnder ?? 'the wrong folder'} but supports ${item.expectedControls.join(', ')} (R9).`;
  }
  return `Supports ${item.expectedControls.length} control(s) of the framework.`;
}

function attachmentRow(item: CatalogueEvidence): AttachmentRow {
  return {
    evidenceId: item.id,
    fileName: item.fileName,
    expectedControlIds: [...item.expectedControls],
    mustAttachNone: item.expectedControls.length === 0,
    notes: attachmentNotes(item)
  };
}

function sufficiencyRows(): SufficiencyRow[] {
  const rows: SufficiencyRow[] = [];
  for (const item of incompleteEvidence()) {
    for (const entry of item.missingElements) {
      rows.push({
        evidenceId: item.id,
        controlId: entry.controlId,
        expectedMissing: [entry.expected],
        expectedPresent: presentElements(item, entry.controlId, entry.expected),
        hint: excerpt(item.summary, 160)
      });
    }
  }
  return rows;
}

/** Every expected element of the control except the ones reported as missing. */
function presentElements(item: CatalogueEvidence, controlId: string, missing: string): string[] {
  const control = findControl(controlId);
  if (control === undefined) return [];
  const gaps = item.missingElements.filter((entry) => entry.controlId === controlId).map((entry) => entry.expected);
  return control.expectedEvidence.filter((element) => element !== missing && !gaps.includes(element));
}

/** Highest access level among a list of evidence ids; `null` when empty. */
function maxAccess(ids: readonly string[]): AccessLevel | null {
  let level: AccessLevel | null = null;
  for (const id of ids) {
    const item = findEvidence(id);
    if (item === undefined) continue;
    if (level === null || ACCESS_ORDER.indexOf(item.accessLevel) > ACCESS_ORDER.indexOf(level)) {
      level = item.accessLevel;
    }
  }
  return level;
}

function qaRow(index: number): QaRow {
  const item = QUESTIONS[index];
  if (item === undefined) throw new Error(`question ${index} is missing`);
  return {
    questionId: item.id,
    question: item.question,
    expectedAnswerKind: item.expectedAnswerKind,
    expectedEvidenceIds: [...item.expectedEvidenceIds],
    requiredAccessLevel: maxAccess(item.expectedEvidenceIds),
    intent: item.intent
  };
}

export interface BuiltDatasets {
  reading: ReadingRow[];
  attachment: AttachmentRow[];
  sufficiency: SufficiencyRow[];
  qa: QaRow[];
}

/** Builds all four datasets in catalogue order (deterministic). */
export function buildDatasetRows(): BuiltDatasets {
  return {
    reading: EVIDENCE.map(readingRow),
    attachment: EVIDENCE.map(attachmentRow),
    sufficiency: sufficiencyRows(),
    qa: QUESTIONS.map((_item, index) => qaRow(index))
  };
}
