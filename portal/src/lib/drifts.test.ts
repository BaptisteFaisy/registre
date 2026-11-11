import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIFT_KIND_META,
  driftMeta,
  driftTransition,
  latestDrifts,
  openDrifts,
  sortDrifts
} from './drifts.ts';
import type { DriftEvent, DriftKind } from '../api/types.ts';

function drift(patch: Partial<DriftEvent> = {}): DriftEvent {
  return {
    id: 'dr-1',
    controlId: 'SEC-02',
    frameworkId: 'fw-msp-demo',
    evidenceId: 'ev-021',
    detectedAt: '2026-11-09T04:00:00.000Z',
    kind: 'STATE_CHANGED',
    previous: 'enabled',
    current: 'disabled',
    detail: 'MFA on the admin account was disabled.',
    reminderId: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...patch
  };
}

const FIVE: DriftEvent[] = [
  drift({ id: 'dr-1', detectedAt: '2026-11-05T04:00:00.000Z', kind: 'STATE_CHANGED' }),
  drift({
    id: 'dr-2',
    detectedAt: '2026-11-08T04:00:00.000Z',
    kind: 'MISSING_RUN',
    previous: null,
    current: null,
    acknowledgedAt: '2026-11-08T09:00:00.000Z',
    acknowledgedBy: 'Amina Diallo'
  }),
  drift({ id: 'dr-3', detectedAt: '2026-11-09T04:00:00.000Z', kind: 'THRESHOLD_CROSSED' }),
  drift({ id: 'dr-4', detectedAt: '2026-11-10T04:00:00.000Z', kind: 'RECOVERED' }),
  drift({ id: 'dr-5', detectedAt: '2026-11-11T04:00:00.000Z', kind: 'STATE_CHANGED' })
];

test('every drift kind has a label, a colour and a meaning', () => {
  const kinds = Object.keys(DRIFT_KIND_META) as DriftKind[];
  assert.deepEqual(kinds.sort(), [
    'MISSING_RUN',
    'RECOVERED',
    'STATE_CHANGED',
    'THRESHOLD_CROSSED'
  ]);
  for (const kind of kinds) {
    assert.ok(driftMeta(kind).label.length > 3);
    assert.match(driftMeta(kind).color, /^#[0-9a-f]{6}$/i);
    assert.ok(driftMeta(kind).description.length > 20);
  }
});

test('sorting is newest first and stable on equal timestamps', () => {
  const sorted = sortDrifts(FIVE);
  assert.deepEqual(
    sorted.map((event) => event.id),
    ['dr-5', 'dr-4', 'dr-3', 'dr-2', 'dr-1']
  );
  const tie = sortDrifts([
    drift({ id: 'b', detectedAt: '2026-11-09T04:00:00.000Z' }),
    drift({ id: 'a', detectedAt: '2026-11-09T04:00:00.000Z' })
  ]);
  assert.deepEqual(
    tie.map((event) => event.id),
    ['a', 'b']
  );
});

test('open drifts are the ones nobody acknowledged, newest first', () => {
  const open = openDrifts(FIVE);
  assert.deepEqual(
    open.map((event) => event.id),
    ['dr-5', 'dr-4', 'dr-3', 'dr-1']
  );
});

test('the latest drifts are capped and newest first', () => {
  assert.deepEqual(
    latestDrifts(FIVE, 3).map((event) => event.id),
    ['dr-5', 'dr-4', 'dr-3']
  );
  assert.equal(latestDrifts(FIVE, 99).length, 5);
});

test('the transition reads both values, and says so on a first observation', () => {
  assert.equal(driftTransition('enabled', 'disabled'), 'enabled → disabled');
  assert.equal(driftTransition(null, 'enabled'), 'first observation: enabled');
  assert.equal(driftTransition('enabled', null), 'enabled → no value');
  assert.equal(driftTransition(null, null), 'no value');
});
