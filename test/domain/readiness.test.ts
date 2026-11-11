/**
 * Readiness aggregation tests — EF-FRA-03, EF-FRA-04 (spec 4.1, 8.4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReadiness,
  computeTrendPoint,
  countStates,
  detectKnownGaps,
  emptyCounts,
  gapDetail,
  shareOf,
  summariseTrend
} from '../../src/domain/readiness.ts';
import type { ControlStatus, ReadinessTrendPoint } from '../../src/domain/types.ts';
import { makeStatus, TEST_NOW } from '../fixtures/builders.ts';

const status = (controlId: string, state: ControlStatus['state'], overrides: Partial<ControlStatus> = {}): ControlStatus =>
  makeStatus({ controlId, state, ...overrides });

test('counts every state of a framework', () => {
  const counts = countStates([
    status('C1', 'COVERED'),
    status('C2', 'COVERED'),
    status('C3', 'EXPIRED'),
    status('C4', 'NO_EVIDENCE')
  ]);
  assert.equal(counts.COVERED, 2);
  assert.equal(counts.EXPIRED, 1);
  assert.equal(counts.NO_EVIDENCE, 1);
  assert.equal(counts.TO_RENEW, 0);
  assert.equal(counts.TO_VERIFY, 0);
});

test('shares are rounded to four decimals and sum to one', () => {
  const statuses = [status('C1', 'COVERED'), status('C2', 'TO_RENEW'), status('C3', 'NO_EVIDENCE')];
  const readiness = computeReadiness('demo-msp', statuses, TEST_NOW);
  assert.equal(readiness.total, 3);
  assert.equal(readiness.frameworkId, 'demo-msp');
  assert.equal(readiness.computedAt, TEST_NOW);
  const sum = Object.values(readiness.shares).reduce((total, share) => total + share, 0);
  assert.ok(Math.abs(sum - 1) <= 0.0001, `shares must sum to 1, got ${sum}`);
  assert.equal(readiness.shares.TO_RENEW, 0.3333);
});

test('an empty framework has zero shares instead of NaN', () => {
  const readiness = computeReadiness('demo-msp', [], TEST_NOW);
  assert.equal(readiness.total, 0);
  assert.deepEqual(readiness.counts, emptyCounts());
  assert.equal(readiness.shares.COVERED, 0);
  assert.equal(shareOf(3, 0), 0);
});

test('known gaps list every control that is not covered, with a detail', () => {
  const gaps = detectKnownGaps([
    status('C2', 'EXPIRED', { expiresAt: '2026-05-11T00:00:00.000Z' }),
    status('C1', 'COVERED'),
    status('C3', 'TO_VERIFY', { notes: ['sufficiency-not-complete'] }),
    status('C4', 'NO_EVIDENCE')
  ]);
  assert.deepEqual(gaps.map((gap) => gap.controlId), ['C2', 'C3', 'C4']);
  assert.match(gaps[0]!.detail, /2026-05-11/);
  assert.match(gaps[1]!.detail, /not all present/);
  assert.match(gaps[2]!.detail, /no applied evidence/);
});

test('the gap detail of a covered control is explicit about freshness', () => {
  assert.match(gapDetail(makeStatus({ state: 'COVERED' })), /fresh and complete/);
  assert.match(gapDetail(makeStatus({ state: 'TO_RENEW', expiresAt: null })), /unknown date/);
});

test('a trend point snapshots the counts at one instant', () => {
  const point = computeTrendPoint('demo-msp', [status('C1', 'COVERED'), status('C2', 'EXPIRED')], TEST_NOW);
  assert.equal(point.frameworkId, 'demo-msp');
  assert.equal(point.at, TEST_NOW);
  assert.equal(point.counts.COVERED, 1);
  assert.equal(point.counts.EXPIRED, 1);
});

test('the trend summary reads the covered direction over the history', () => {
  const points: ReadinessTrendPoint[] = [
    { frameworkId: 'demo-msp', at: '2026-05-11T00:00:00.000Z', counts: { ...emptyCounts(), COVERED: 4 } },
    { frameworkId: 'demo-msp', at: '2026-08-11T00:00:00.000Z', counts: { ...emptyCounts(), COVERED: 7 } }
  ];
  const summary = summariseTrend(points);
  assert.equal(summary.samples, 2);
  assert.equal(summary.coveredDelta, 3);
  assert.equal(summary.direction, 'UP');
  assert.equal(summary.from!.counts.COVERED, 4);
  assert.equal(summary.to!.counts.COVERED, 7);
});

test('an empty or flat history is reported without inventing a direction', () => {
  const empty = summariseTrend([]);
  assert.equal(empty.direction, 'UNKNOWN');
  assert.equal(empty.samples, 0);
  const flat: ReadinessTrendPoint[] = [
    { frameworkId: 'demo-msp', at: '2026-08-11T00:00:00.000Z', counts: emptyCounts() },
    { frameworkId: 'demo-msp', at: '2026-11-11T00:00:00.000Z', counts: emptyCounts() }
  ];
  assert.equal(summariseTrend(flat).direction, 'FLAT');
});
