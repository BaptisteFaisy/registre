/**
 * Vocabulary guard tests — ENF-IA-01, recette R15.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertForbiddenWordsAbsent,
  containsForbiddenWord,
  findViolations,
  FORBIDDEN_STEMS,
  ALLOWED_NOUNS,
  RECOMMENDED_VOCABULARY
} from '../../src/domain/vocabulary.ts';
import { CONTROL_STATES } from '../../src/domain/types.ts';
import type { ControlState, EvidenceFreshness, SufficiencyClass } from '../../src/domain/types.ts';
import { RegistreError } from '../../src/support/errors.ts';

const FRESHNESS: readonly EvidenceFreshness[] = ['FRESH', 'TO_RENEW', 'EXPIRED', 'UNDETERMINED'];
const SUFFICIENCY: readonly SufficiencyClass[] = ['COMPLETE', 'PARTIAL', 'TO_VERIFY'];

test('English forbidden forms are detected', () => {
  assert.equal(containsForbiddenWord('This control is compliant.'), true);
  assert.equal(containsForbiddenWord('a non-compliant environment'), true);
  assert.equal(containsForbiddenWord('a non compliant environment'), true);
  // The judgement is forbidden, the discipline is not: "in compliance" qualifies
  // the control, while the bare noun names a function or a calendar.
  assert.equal(containsForbiddenWord('the control is in compliance'), true);
  assert.equal(containsForbiddenWord('Evidence of compliance'), false);
  assert.equal(containsForbiddenWord('Quality and Compliance Lead'), false);
});

test('French forbidden forms are detected, including non-conforme', () => {
  assert.equal(containsForbiddenWord('Le contrôle est conforme.'), true);
  assert.equal(containsForbiddenWord('Ce point est non-conforme.'), true);
  assert.equal(containsForbiddenWord('ce point est non conforme'), true);
  assert.equal(containsForbiddenWord('des contrôles conformes'), true);
});

test('the stem list declares the French and English forms of the ban', () => {
  for (const stem of ['conforme', 'conformes', 'non-conforme', 'compliant', 'compliants', 'non-compliant', 'in compliance', 'en conformité']) {
    assert.ok(FORBIDDEN_STEMS.includes(stem), `${stem} must be declared`);
  }
  assert.deepEqual([...ALLOWED_NOUNS], ['compliance', 'conformité']);
});

test('neutral wording is not flagged', () => {
  assert.equal(containsForbiddenWord('The control is covered by fresh evidence.'), false);
  assert.equal(containsForbiddenWord('Le contrôle est couvert, preuve à jour.'), false);
  assert.equal(containsForbiddenWord(''), false);
});

test('violations carry the offending word, its offset and a context snippet', () => {
  const text = 'The policy is compliant. The audit is compliant too.';
  const violations = findViolations(text);
  assert.equal(violations.length, 2);
  assert.equal(violations[0]!.word, 'compliant');
  assert.equal(text.slice(violations[1]!.index, violations[1]!.index + 9), 'compliant');
  assert.match(violations[0]!.snippet, /policy is compliant/);
});

test('assertForbiddenWordsAbsent rejects a violating output with a BAD_REQUEST', () => {
  assert.throws(
    () => assertForbiddenWordsAbsent('Control CONT-01 is compliant', 'pack index'),
    (error: unknown) => error instanceof RegistreError && error.code === 'BAD_REQUEST' && /ENF-IA-01/.test(error.message)
  );
  assert.doesNotThrow(() => assertForbiddenWordsAbsent('Control CONT-01 is covered'));
});

test('R15 — no control state, freshness or sufficiency label uses a forbidden word', () => {
  const labels: Array<ControlState | EvidenceFreshness | SufficiencyClass> = [
    ...CONTROL_STATES,
    ...FRESHNESS,
    ...SUFFICIENCY
  ];
  for (const label of labels) {
    assert.equal(containsForbiddenWord(label), false, `state ${label} must stay neutral`);
    assert.equal(containsForbiddenWord(label.replace(/_/g, ' ')), false);
  }
});

test('the recommended vocabulary keeps the audit nuance', () => {
  for (const phrase of Object.values(RECOMMENDED_VOCABULARY)) {
    assert.equal(containsForbiddenWord(phrase), false);
  }
  assert.match(RECOMMENDED_VOCABULARY.covered, /covered/);
  assert.match(RECOMMENDED_VOCABULARY.partial, /partial/);
});
