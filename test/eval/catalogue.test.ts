/**
 * Catalogue integrity — the shared source of truth the demo generator imports.
 *
 * Guards the invariants the specification fixes: 30 controls over six domains,
 * 60 evidence, the six seeded situations of chapter 18.1, unique ids and
 * evidence that only references controls that exist.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROLS,
  DOMAINS,
  EVIDENCE,
  EXPECTED_COUNTS,
  MANDATORY_SITUATIONS,
  PERIODICITIES,
  QUESTIONS,
  SEEDED_SITUATIONS,
  catalogueTexts,
  findControl,
  findEvidence,
  incompleteEvidence,
  toFrameworkImport,
  validateCatalogue
} from '../../eval/catalogue.ts';
import { isIsoDate, parseDuration } from '../../src/support/iso8601.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';
import { ACCESS_ORDER, EVIDENCE_TYPES } from '../../src/domain/types.ts';

test('the catalogue validates without a single problem', () => {
  assert.deepEqual(validateCatalogue(), []);
});

test('30 controls over six domains, five per domain', () => {
  assert.equal(CONTROLS.length, EXPECTED_COUNTS.controls);
  assert.equal(DOMAINS.length, EXPECTED_COUNTS.domains);
  for (const domain of DOMAINS) {
    const owned = CONTROLS.filter((control) => control.domain === domain.id);
    assert.equal(owned.length, EXPECTED_COUNTS.controlsPerDomain, domain.id);
  }
});

test('control ids are CONT-01 … CONT-30 and unique', () => {
  const ids = CONTROLS.map((control) => control.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, Array.from({ length: 30 }, (_value, index) => `CONT-${String(index + 1).padStart(2, '0')}`));
});

test('every control carries a requirement, expected evidence, an owner and a valid periodicity', () => {
  for (const control of CONTROLS) {
    assert.ok(control.requirement.length >= 20, control.id);
    assert.ok(control.expectedEvidence.length > 0, control.id);
    assert.ok(control.owner.length > 0, control.id);
    assert.ok(PERIODICITIES.includes(control.periodicity), control.id);
    assert.doesNotThrow(() => parseDuration(control.periodicity), control.id);
  }
});

test('periodicities are spread over the four ISO-8601 durations', () => {
  const used = new Set(CONTROLS.map((control) => control.periodicity));
  assert.deepEqual([...used].sort(), ['P1M', 'P1Y', 'P3M', 'P6M']);
});

test('at least one control per domain is mandatory', () => {
  for (const domain of DOMAINS) {
    const mandatory = CONTROLS.filter((control) => control.domain === domain.id && control.mandatory);
    assert.ok(mandatory.length > 0, domain.id);
  }
});

test('60 evidence with unique ids and unique file names', () => {
  assert.equal(EVIDENCE.length, EXPECTED_COUNTS.evidence);
  assert.equal(new Set(EVIDENCE.map((item) => item.id)).size, EVIDENCE.length);
  assert.equal(new Set(EVIDENCE.map((item) => item.fileName)).size, EVIDENCE.length);
});

test('every evidence uses the closed type list, a real date and a known access level', () => {
  for (const item of EVIDENCE) {
    assert.ok(EVIDENCE_TYPES.includes(item.type), `${item.id} type`);
    assert.ok(isIsoDate(item.documentDate), `${item.id} date`);
    assert.ok(ACCESS_ORDER.includes(item.accessLevel), `${item.id} access`);
    if (item.personalData) assert.equal(item.accessLevel, 'RESTRICTED', `${item.id} personal data`);
    if (item.approver === null) assert.equal(item.approvalDate, null, `${item.id} unsigned but dated`);
  }
});

test('every evidence references controls that exist', () => {
  for (const item of EVIDENCE) {
    for (const controlId of item.expectedControls) {
      assert.ok(findControl(controlId) !== undefined, `${item.id} → ${controlId}`);
    }
  }
});

test('each control is supported by at least one evidence', () => {
  for (const control of CONTROLS) {
    const supporters = EVIDENCE.filter((item) => item.expectedControls.includes(control.id));
    assert.ok(supporters.length > 0, `${control.id} has no evidence`);
  }
});

test('the six situations of chapter 18.1 are all seeded', () => {
  const kinds = new Set(SEEDED_SITUATIONS.map((situation) => situation.kind));
  for (const kind of MANDATORY_SITUATIONS) assert.ok(kinds.has(kind), kind);
  assert.ok(MANDATORY_SITUATIONS.length >= 6);
});

test('each mandatory situation points at the evidence or the control it exercises', () => {
  for (const kind of MANDATORY_SITUATIONS) {
    const situation = SEEDED_SITUATIONS.find((candidate) => candidate.kind === kind);
    assert.ok(situation !== undefined, kind);
    if (situation.controlId !== null) assert.ok(findControl(situation.controlId) !== undefined, kind);
    for (const evidenceId of situation.evidenceIds) assert.ok(findEvidence(evidenceId) !== undefined, `${kind}: ${evidenceId}`);
    assert.match(situation.scenario, /^R\d+$/);
  }
});

test('the seeded situations carry the expected shape', () => {
  const stale = SEEDED_SITUATIONS.find((situation) => situation.kind === 'STALE_SECURITY_POLICY');
  assert.deepEqual(stale?.evidenceIds, ['EV-001']);
  const absence = SEEDED_SITUATIONS.find((situation) => situation.kind === 'NO_RESTORE_TEST_THIS_QUARTER');
  assert.deepEqual(absence?.evidenceIds, [], 'an absence has no evidence to point at');
  const duplicate = SEEDED_SITUATIONS.find((situation) => situation.kind === 'DUPLICATE_DOCUMENT');
  assert.equal(duplicate?.evidenceIds.length, 2);
  const misfiled = SEEDED_SITUATIONS.find((situation) => situation.kind === 'MISFILED_EVIDENCE');
  assert.notEqual(findEvidence(misfiled?.evidenceIds[0] ?? '')?.filedUnder, null);
});

test('the extra edge cases are present: unrelated, unreadable, personal data, screenshot', () => {
  const kinds = SEEDED_SITUATIONS.map((situation) => situation.kind);
  for (const kind of ['UNRELATED_EVIDENCE', 'UNREADABLE_EVIDENCE', 'PERSONAL_DATA_RESTRICTED', 'SCREENSHOT_DATE_TO_CONFIRM']) {
    assert.ok(kinds.includes(kind as (typeof kinds)[number]), kind);
  }
  const unrelated = EVIDENCE.find((item) => item.seededSituation === 'UNRELATED_EVIDENCE');
  assert.deepEqual(unrelated?.expectedControls, [], 'R10: supports no control');
  assert.equal(EVIDENCE.filter((item) => item.unreadable).length, 1);
  assert.ok(EVIDENCE.filter((item) => item.personalData).length >= 3);
  assert.ok(EVIDENCE.filter((item) => item.dateToConfirm).length >= 2);
});

test('the duplicate situation really is a duplicate pair', () => {
  const copy = EVIDENCE.find((item) => item.duplicateOf !== null);
  assert.ok(copy !== undefined);
  const original = findEvidence(copy.duplicateOf ?? '');
  assert.ok(original !== undefined);
  assert.equal(copy.documentDate, original.documentDate);
  assert.deepEqual(copy.expectedControls, original.expectedControls);
});

test('twenty evidence carry expected sufficiency gaps', () => {
  assert.equal(incompleteEvidence().length, EXPECTED_COUNTS.incompleteEvidence);
  for (const item of incompleteEvidence()) {
    for (const entry of item.missingElements) {
      const control = findControl(entry.controlId);
      assert.ok(control?.expectedEvidence.includes(entry.expected), `${item.id}: ${entry.expected}`);
    }
  }
});

test('twenty questions with evidence plus five traps', () => {
  const withEvidence = QUESTIONS.filter((question) => question.expectedAnswerKind === 'EVIDENCE');
  const traps = QUESTIONS.filter((question) => question.expectedAnswerKind === 'NO_EVIDENCE');
  assert.equal(withEvidence.length, EXPECTED_COUNTS.questionsWithEvidence);
  assert.equal(traps.length, EXPECTED_COUNTS.trapQuestions);
  for (const trap of traps) assert.deepEqual(trap.expectedEvidenceIds, []);
});

test('the framework import payload follows Annex A', () => {
  const payload = toFrameworkImport();
  assert.equal(payload.controls.length, 30);
  assert.equal(payload.framework.id, 'demo-msp');
  for (const control of payload.controls) {
    assert.deepEqual(Object.keys(control).sort(), [
      'domain',
      'expectedEvidence',
      'id',
      'mandatory',
      'owner',
      'periodicity',
      'requirement',
      'title'
    ]);
  }
});

test('no catalogue text uses the forbidden wording', () => {
  const offenders = catalogueTexts().filter((text) => containsForbiddenWord(text));
  assert.deepEqual(offenders, []);
});

test('importing the catalogue has no side effect on the exported rows', () => {
  const first = listSnapshot();
  const payload = toFrameworkImport();
  payload.controls[0]?.expectedEvidence.push('mutated');
  assert.equal(listSnapshot(), first);
});

function listSnapshot(): string {
  return JSON.stringify({
    controls: CONTROLS.map((control) => control.id),
    evidence: EVIDENCE.map((item) => [item.id, item.expectedControls.join(',')]),
    situations: SEEDED_SITUATIONS.map((situation) => situation.kind)
  });
}
