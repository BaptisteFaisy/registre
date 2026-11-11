import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_LABEL,
  ATTACHMENT_STATUS_LABEL,
  FRESHNESS_LABEL,
  ROLE_LABEL,
  STATE_META,
  STATE_ORDER,
  VALIDATION_KIND_LABEL,
  emptyCounts,
  sortStates,
  stateColor,
  stateLabel,
  stateMeta,
  sufficiencyColor,
  sufficiencyLabel
} from './states.ts';
import type { ControlState } from '../api/types.ts';

const STATES: ControlState[] = ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE'];

/** The forbidden stems, assembled so this test file never spells them out. */
function forbiddenWording(): RegExp {
  return new RegExp(['compl', 'iant', '|conf', 'orme'].join(''), 'i');
}

test('the five control states have a label and a colour', () => {
  assert.deepEqual(STATE_ORDER, STATES);
  for (const state of STATES) {
    assert.ok(stateLabel(state).length > 0, `label of ${state}`);
    assert.match(stateColor(state), /^#[0-9a-f]{6}$/i, `colour of ${state}`);
    assert.ok(STATE_META[state].description.length > 20, `description of ${state}`);
  }
});

test('no state label uses the forbidden wording', () => {
  const forbidden = forbiddenWording();
  for (const state of STATES) {
    assert.doesNotMatch(stateLabel(state), forbidden);
    assert.doesNotMatch(STATE_META[state].description, forbidden);
  }
});

test('stateMeta falls back to the worst state for an unknown value', () => {
  assert.equal(stateMeta('SOMETHING_ELSE' as ControlState).label, 'No evidence');
});

test('sortStates follows the canonical display order', () => {
  const shuffled: ControlState[] = ['NO_EVIDENCE', 'COVERED', 'EXPIRED', 'TO_RENEW', 'TO_VERIFY'];
  assert.deepEqual(sortStates(shuffled), STATES);
});

test('emptyCounts contains every state at zero', () => {
  const counts = emptyCounts();
  assert.deepEqual(Object.keys(counts).sort(), [...STATES].sort());
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 0);
});

test('sufficiency labels and colours cover the three classes', () => {
  assert.equal(sufficiencyLabel('COMPLETE'), 'Complete');
  assert.equal(sufficiencyLabel('PARTIAL'), 'Partial');
  assert.equal(sufficiencyLabel('TO_VERIFY'), 'To verify');
  assert.match(sufficiencyColor('COMPLETE'), /^#/);
});

test('every dictionary covers its closed list', () => {
  assert.equal(Object.keys(FRESHNESS_LABEL).length, 4);
  assert.equal(Object.keys(ATTACHMENT_STATUS_LABEL).length, 3);
  assert.equal(Object.keys(ACCESS_LABEL).length, 3);
  assert.equal(Object.keys(ROLE_LABEL).length, 5);
  assert.equal(Object.keys(VALIDATION_KIND_LABEL).length, 3);
});
