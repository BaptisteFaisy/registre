/**
 * The four generated datasets: row counts, schema validity, and the rule that
 * they stay in sync with the catalogue (no hand editing).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLS, EVIDENCE, QUESTIONS, EXPECTED_COUNTS } from '../../eval/catalogue.ts';
import { DATASET_FILES, DATASET_ORDER, validateDataset } from '../../tools/eval/lib/schema.ts';
import { buildDatasetRows } from '../../tools/eval/lib/rows.ts';
import { parseJsonl, serializeJsonl } from '../../tools/eval/lib/jsonl.ts';
import { datasetsDir } from '../../tools/eval/lib/paths.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';

const BUILT = buildDatasetRows();

test('reading.jsonl: 60 rows, one per evidence', () => {
  assert.equal(BUILT.reading.length, EXPECTED_COUNTS.evidence);
  assert.deepEqual(BUILT.reading.map((row) => row.evidenceId), EVIDENCE.map((item) => item.id));
  assert.deepEqual(validateDataset('reading', BUILT.reading), []);
});

test('attachment.jsonl: 60 rows with the expected controls', () => {
  assert.equal(BUILT.attachment.length, EXPECTED_COUNTS.evidence);
  assert.deepEqual(validateDataset('attachment', BUILT.attachment), []);
  for (const row of BUILT.attachment) {
    const item = EVIDENCE.find((candidate) => candidate.id === row.evidenceId);
    assert.deepEqual(row.expectedControlIds, item?.expectedControls);
  }
  assert.equal(BUILT.attachment.filter((row) => row.mustAttachNone).length, 1, 'R10: exactly one unrelated evidence');
});

test('sufficiency.jsonl: 20 rows, each with at least one expected gap', () => {
  assert.equal(BUILT.sufficiency.length, EXPECTED_COUNTS.incompleteEvidence);
  assert.deepEqual(validateDataset('sufficiency', BUILT.sufficiency), []);
  for (const row of BUILT.sufficiency) {
    assert.ok(row.expectedMissing.length > 0, row.evidenceId);
    assert.ok(row.expectedPresent.length > 0, row.evidenceId);
    const control = CONTROLS.find((candidate) => candidate.id === row.controlId);
    for (const element of [...row.expectedMissing, ...row.expectedPresent]) {
      assert.ok(control?.expectedEvidence.includes(element), `${row.evidenceId}: ${element}`);
    }
  }
});

test('qa.jsonl: 25 rows, 20 with evidence and 5 traps', () => {
  assert.equal(BUILT.qa.length, EXPECTED_COUNTS.questionsWithEvidence + EXPECTED_COUNTS.trapQuestions);
  assert.deepEqual(validateDataset('qa', BUILT.qa), []);
  assert.equal(BUILT.qa.filter((row) => row.expectedAnswerKind === 'NO_EVIDENCE').length, EXPECTED_COUNTS.trapQuestions);
  assert.deepEqual(BUILT.qa.map((row) => row.questionId), QUESTIONS.map((question) => question.id));
});

test('access levels of the question rows follow the expected evidence', () => {
  for (const row of BUILT.qa) {
    if (row.expectedAnswerKind === 'NO_EVIDENCE') {
      assert.equal(row.requiredAccessLevel, null, row.questionId);
      continue;
    }
    assert.notEqual(row.requiredAccessLevel, null, row.questionId);
    const levels = row.expectedEvidenceIds.map((id) => EVIDENCE.find((item) => item.id === id)?.accessLevel);
    assert.ok(levels.some((level) => level === row.requiredAccessLevel), row.questionId);
  }
  const restricted = BUILT.qa.filter((row) => row.requiredAccessLevel === 'RESTRICTED');
  assert.ok(restricted.length > 0, 'R13 needs at least one restricted question');
});

test('the files on disk exist, match the catalogue and are valid JSONL', () => {
  for (const name of DATASET_ORDER) {
    const path = join(datasetsDir(), DATASET_FILES[name]);
    assert.ok(existsSync(path), `${DATASET_FILES[name]} missing: run node tools/eval/buildDatasets.ts`);
    const text = readFileSync(path, 'utf8');
    const rows = parseJsonl(text);
    assert.equal(rows.length, BUILT[name].length, DATASET_FILES[name]);
    assert.equal(text, serializeJsonl(BUILT[name]), `${DATASET_FILES[name]} is stale`);
    assert.deepEqual(validateDataset(name, rows), [], DATASET_FILES[name]);
  }
});

test('no dataset line uses the forbidden wording', () => {
  for (const name of DATASET_ORDER) {
    const text = serializeJsonl(BUILT[name]);
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      assert.equal(containsForbiddenWord(line), false, `${DATASET_FILES[name]}: ${line.slice(0, 90)}`);
    }
  }
});

test('the schema validators reject malformed rows', () => {
  assert.notDeepEqual(validateDataset('reading', [{ evidenceId: 'EV-001' }]), []);
  assert.notDeepEqual(validateDataset('attachment', [{ ...BUILT.attachment[0], expectedControlIds: ['CONT-1'] }]), []);
  assert.notDeepEqual(validateDataset('attachment', [{ ...BUILT.attachment[0], mustAttachNone: true }]), []);
  assert.notDeepEqual(validateDataset('sufficiency', [{ ...BUILT.sufficiency[0], expectedMissing: [] }]), []);
  assert.notDeepEqual(validateDataset('qa', [{ ...BUILT.qa[0], expectedAnswerKind: 'MAYBE' }]), []);
  assert.notDeepEqual(validateDataset('qa', [{ ...BUILT.qa[0], expectedEvidenceIds: [] }]), []);
});

test('a reading row declares every Annex B field', () => {
  const keys = Object.keys(BUILT.reading[0]?.expectedFields ?? {}).sort();
  assert.deepEqual(keys, [
    'approvalDate',
    'approver',
    'author',
    'client',
    'documentDate',
    'period',
    'personalData',
    'title',
    'type',
    'version'
  ]);
});
