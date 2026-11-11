/**
 * Catalogue integrity checks. `buildDatasets` runs them before writing, and the
 * test suite asserts that the returned list is empty: a catalogue that drifts
 * from the specification must fail loudly rather than produce wrong datasets.
 */

import type { CatalogueEvidence, SeededSituationKind } from './types.ts';
import { DOMAINS, PERIODICITIES } from './types.ts';
import { ACCESS_ORDER, EVIDENCE_TYPES } from '../../src/domain/types.ts';
import { isIsoDate, parseDuration } from '../../src/support/iso8601.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';
import { CONTROLS } from './controls.ts';
import { EVIDENCE, incompleteEvidence } from './evidence.ts';
import { QUESTIONS } from './questions.ts';
import { SEEDED_SITUATIONS } from './situations.ts';

export interface CatalogueProblem {
  code: string;
  detail: string;
}

/** The six situations chapter 18.1 requires in the demonstration data. */
export const MANDATORY_SITUATIONS: readonly SeededSituationKind[] = [
  'STALE_SECURITY_POLICY',
  'NO_RESTORE_TEST_THIS_QUARTER',
  'RESTORE_REPORT_MISSING_DURATION',
  'UNSIGNED_PROCEDURE',
  'MISFILED_EVIDENCE',
  'DUPLICATE_DOCUMENT'
] as const;

export const EXPECTED_COUNTS = {
  controls: 30,
  evidence: 60,
  incompleteEvidence: 20,
  questionsWithEvidence: 20,
  trapQuestions: 5,
  domains: 6,
  controlsPerDomain: 5
} as const;

function push(problems: CatalogueProblem[], code: string, detail: string): void {
  problems.push({ code, detail });
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/* ------------------------------------------------------------------ counts */

function checkCounts(problems: CatalogueProblem[]): void {
  if (CONTROLS.length !== EXPECTED_COUNTS.controls) {
    push(problems, 'controls.count', `expected ${EXPECTED_COUNTS.controls}, found ${CONTROLS.length}`);
  }
  if (EVIDENCE.length !== EXPECTED_COUNTS.evidence) {
    push(problems, 'evidence.count', `expected ${EXPECTED_COUNTS.evidence}, found ${EVIDENCE.length}`);
  }
  if (incompleteEvidence().length !== EXPECTED_COUNTS.incompleteEvidence) {
    push(problems, 'evidence.incomplete', `expected ${EXPECTED_COUNTS.incompleteEvidence}, found ${incompleteEvidence().length}`);
  }
  if (DOMAINS.length !== EXPECTED_COUNTS.domains) {
    push(problems, 'domains.count', `expected ${EXPECTED_COUNTS.domains}, found ${DOMAINS.length}`);
  }
  for (const domain of DOMAINS) {
    const owned = CONTROLS.filter((control) => control.domain === domain.id).length;
    if (owned !== EXPECTED_COUNTS.controlsPerDomain) {
      push(problems, 'domains.spread', `${domain.id}: expected ${EXPECTED_COUNTS.controlsPerDomain}, found ${owned}`);
    }
  }
  const withEvidence = QUESTIONS.filter((item) => item.expectedAnswerKind === 'EVIDENCE').length;
  const traps = QUESTIONS.filter((item) => item.expectedAnswerKind === 'NO_EVIDENCE').length;
  if (withEvidence !== EXPECTED_COUNTS.questionsWithEvidence) {
    push(problems, 'questions.evidence', `expected ${EXPECTED_COUNTS.questionsWithEvidence}, found ${withEvidence}`);
  }
  if (traps !== EXPECTED_COUNTS.trapQuestions) {
    push(problems, 'questions.traps', `expected ${EXPECTED_COUNTS.trapQuestions}, found ${traps}`);
  }
}

/* ---------------------------------------------------------------- controls */

function checkControl(control: (typeof CONTROLS)[number], problems: CatalogueProblem[]): void {
  if (control.expectedEvidence.length === 0) push(problems, 'control.elements', `${control.id}: no expected evidence`);
  if (duplicates(control.expectedEvidence).length > 0) push(problems, 'control.elements', `${control.id}: duplicated element`);
  if (!PERIODICITIES.includes(control.periodicity)) push(problems, 'control.periodicity', `${control.id}: ${control.periodicity}`);
  try {
    parseDuration(control.periodicity);
  } catch {
    push(problems, 'control.periodicity', `${control.id}: not an ISO-8601 duration`);
  }
  if (control.title.trim().length < 8) push(problems, 'control.title', `${control.id}: title too short`);
  if (control.requirement.trim().length < 20) push(problems, 'control.requirement', `${control.id}: requirement too short`);
}

function checkControls(problems: CatalogueProblem[]): void {
  const ids = CONTROLS.map((control) => control.id);
  for (const id of duplicates(ids)) push(problems, 'control.id', `${id}: duplicated`);
  CONTROLS.forEach((control, index) => {
    const expectedId = `CONT-${String(index + 1).padStart(2, '0')}`;
    if (control.id !== expectedId) push(problems, 'control.id', `${control.id}: expected ${expectedId}`);
    checkControl(control, problems);
  });
}

/* ---------------------------------------------------------------- evidence */

function checkDates(item: CatalogueEvidence, problems: CatalogueProblem[]): void {
  if (!isIsoDate(item.documentDate)) push(problems, 'evidence.date', `${item.id}: ${item.documentDate}`);
  if (item.approvalDate !== null && !isIsoDate(item.approvalDate)) {
    push(problems, 'evidence.date', `${item.id}: approval date ${item.approvalDate}`);
  }
  if (item.period === null) return;
  const { start, end } = item.period;
  if (start !== null && !isIsoDate(start)) push(problems, 'evidence.period', `${item.id}: start ${start}`);
  if (end !== null && !isIsoDate(end)) push(problems, 'evidence.period', `${item.id}: end ${end}`);
  if (start !== null && end !== null && start > end) push(problems, 'evidence.period', `${item.id}: start after end`);
}

function checkAccess(item: CatalogueEvidence, problems: CatalogueProblem[]): void {
  if (!ACCESS_ORDER.includes(item.accessLevel)) push(problems, 'evidence.access', `${item.id}: ${item.accessLevel}`);
  if (item.personalData && item.accessLevel !== 'RESTRICTED') {
    push(problems, 'evidence.access', `${item.id}: personal data requires RESTRICTED`);
  }
}

function checkGaps(item: CatalogueEvidence, problems: CatalogueProblem[]): void {
  for (const entry of item.missingElements) {
    const control = CONTROLS.find((candidate) => candidate.id === entry.controlId);
    if (control === undefined) {
      push(problems, 'evidence.gap', `${item.id}: unknown control ${entry.controlId}`);
      continue;
    }
    if (!item.expectedControls.includes(entry.controlId)) {
      push(problems, 'evidence.gap', `${item.id}: gap on unsupported control ${entry.controlId}`);
    }
    if (!control.expectedEvidence.includes(entry.expected)) {
      push(problems, 'evidence.gap', `${item.id}: "${entry.expected}" is not expected by ${entry.controlId}`);
    }
  }
  if (duplicates(item.missingElements.map((entry) => `${entry.controlId}|${entry.expected}`)).length > 0) {
    push(problems, 'evidence.gap', `${item.id}: duplicated gap`);
  }
}

function checkEvidenceItem(item: CatalogueEvidence, problems: CatalogueProblem[]): void {
  if (!EVIDENCE_TYPES.includes(item.type)) push(problems, 'evidence.type', `${item.id}: ${item.type}`);
  if (!item.fileName.includes('.')) push(problems, 'evidence.file', `${item.id}: no extension`);
  if (duplicates(item.expectedControls).length > 0) push(problems, 'evidence.controls', `${item.id}: duplicated control`);
  for (const controlId of item.expectedControls) {
    if (!CONTROLS.some((control) => control.id === controlId)) {
      push(problems, 'evidence.controls', `${item.id}: unknown control ${controlId}`);
    }
  }
  checkDates(item, problems);
  checkAccess(item, problems);
  checkGaps(item, problems);
  if (item.duplicateOf !== null) {
    if (item.duplicateOf === item.id) push(problems, 'evidence.duplicate', `${item.id}: points at itself`);
    if (!EVIDENCE.some((candidate) => candidate.id === item.duplicateOf)) {
      push(problems, 'evidence.duplicate', `${item.id}: unknown original ${item.duplicateOf}`);
    }
  }
  if (item.summary.trim().length < 20) push(problems, 'evidence.summary', `${item.id}: summary too short`);
}

function checkEvidence(problems: CatalogueProblem[]): void {
  const ids = EVIDENCE.map((item) => item.id);
  for (const id of duplicates(ids)) push(problems, 'evidence.id', `${id}: duplicated`);
  for (const name of duplicates(EVIDENCE.map((item) => item.fileName))) {
    push(problems, 'evidence.file', `${name}: used by two evidence`);
  }
  EVIDENCE.forEach((item, index) => {
    const expectedId = `EV-${String(index + 1).padStart(3, '0')}`;
    if (item.id !== expectedId) push(problems, 'evidence.id', `${item.id}: expected ${expectedId}`);
    checkEvidenceItem(item, problems);
  });
}

/* --------------------------------------------------------------- questions */

function checkQuestions(problems: CatalogueProblem[]): void {
  if (duplicates(QUESTIONS.map((item) => item.id)).length > 0) push(problems, 'question.id', 'duplicated question id');
  for (const item of QUESTIONS) {
    if (item.question.trim().length < 15) push(problems, 'question.text', `${item.id}: question too short`);
    for (const evidenceId of item.expectedEvidenceIds) {
      if (!EVIDENCE.some((candidate) => candidate.id === evidenceId)) {
        push(problems, 'question.evidence', `${item.id}: unknown evidence ${evidenceId}`);
      }
    }
    const isEmpty = item.expectedEvidenceIds.length === 0;
    if (isEmpty && item.expectedAnswerKind !== 'NO_EVIDENCE') {
      push(problems, 'question.kind', `${item.id}: no evidence but answer kind is EVIDENCE`);
    }
    if (!isEmpty && item.expectedAnswerKind !== 'EVIDENCE') {
      push(problems, 'question.kind', `${item.id}: evidence expected but answer kind is NO_EVIDENCE`);
    }
  }
}

/* --------------------------------------------------------------- situations */

function checkSituations(problems: CatalogueProblem[]): void {
  if (duplicates(SEEDED_SITUATIONS.map((item) => item.kind)).length > 0) {
    push(problems, 'situation.kind', 'duplicated situation kind');
  }
  const kinds = new Set(SEEDED_SITUATIONS.map((item) => item.kind));
  for (const kind of MANDATORY_SITUATIONS) {
    if (!kinds.has(kind)) {
      push(problems, 'situation.missing', `chapter 18.1 situation absent: ${kind}`);
    }
  }
  for (const situation of SEEDED_SITUATIONS) {
    if (situation.controlId !== null && !CONTROLS.some((control) => control.id === situation.controlId)) {
      push(problems, 'situation.control', `${situation.kind}: unknown control ${situation.controlId}`);
    }
    for (const evidenceId of situation.evidenceIds) {
      if (!EVIDENCE.some((candidate) => candidate.id === evidenceId)) {
        push(problems, 'situation.evidence', `${situation.kind}: unknown evidence ${evidenceId}`);
      }
    }
  }
  for (const item of EVIDENCE) {
    if (item.seededSituation !== null && !kinds.has(item.seededSituation)) {
      push(problems, 'situation.orphan', `${item.id}: unregistered situation ${item.seededSituation}`);
    }
  }
}

/* ----------------------------------------------------------------- wording */

/** Every free-text field of the catalogue, scanned for forbidden wording. */
export function catalogueTexts(): string[] {
  const texts: string[] = [];
  for (const control of CONTROLS) texts.push(control.title, control.requirement, ...control.expectedEvidence);
  for (const item of EVIDENCE) texts.push(item.title, item.summary, item.fileName);
  for (const item of QUESTIONS) texts.push(item.question, item.intent);
  for (const situation of SEEDED_SITUATIONS) texts.push(situation.label);
  return texts;
}

function checkWording(problems: CatalogueProblem[]): void {
  for (const text of catalogueTexts()) {
    if (containsForbiddenWord(text)) push(problems, 'wording', `forbidden wording in: ${text.slice(0, 80)}`);
  }
}

/** Runs every check and returns the problems found (empty list = valid). */
export function validateCatalogue(): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  checkCounts(problems);
  checkControls(problems);
  checkEvidence(problems);
  checkQuestions(problems);
  checkSituations(problems);
  checkWording(problems);
  return problems;
}
