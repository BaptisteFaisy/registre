import test from 'node:test';
import assert from 'node:assert/strict';

import {
  daysBetween,
  formatBytes,
  formatConfidence,
  formatCount,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPeriodicity,
  formatRelative,
  formatUsd,
  humanizeToken,
  shortHash
} from './format.ts';

test('formatDate renders an ISO date and a dash for empty values', () => {
  assert.equal(formatDate('2026-03-12T00:00:00.000Z'), '12 Mar 2026');
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate('not-a-date'), '—');
});

test('formatDateTime adds the UTC time', () => {
  assert.equal(formatDateTime('2026-03-12T09:05:00.000Z'), '12 Mar 2026, 09:05');
});

test('formatRelative speaks in days around the reference instant', () => {
  const now = '2026-11-11T09:00:00.000Z';
  assert.equal(formatRelative('2026-11-11T09:00:00.000Z', now), 'today');
  assert.equal(formatRelative('2026-11-12T09:00:00.000Z', now), 'tomorrow');
  assert.equal(formatRelative('2026-11-10T09:00:00.000Z', now), 'yesterday');
  assert.equal(formatRelative('2026-11-29T09:00:00.000Z', now), 'in 18 days');
  assert.equal(formatRelative('2026-09-30T09:00:00.000Z', now), '42 days ago');
});

test('daysBetween rounds down and goes negative in the past', () => {
  assert.equal(daysBetween('2026-11-01T00:00:00.000Z', '2026-11-11T00:00:00.000Z'), 10);
  assert.equal(daysBetween('2026-11-11T00:00:00.000Z', '2026-11-01T00:00:00.000Z'), -10);
});

test('formatPercent and formatConfidence round as expected', () => {
  assert.equal(formatPercent(0.425), '42.5 %');
  assert.equal(formatPercent(0, 0), '0 %');
  assert.equal(formatConfidence(0.93), '93 %');
});

test('formatCount and formatUsd use readable separators', () => {
  assert.equal(formatCount(1234), '1,234');
  assert.equal(formatUsd(0.1234), '$0.12');
});

test('shortHash keeps the first twelve characters', () => {
  assert.equal(shortHash('abcdef0123456789'), 'abcdef012345');
  assert.equal(shortHash(null), '—');
});

test('formatBytes switches unit above a kilobyte', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 kB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('formatPeriodicity turns ISO durations into words', () => {
  assert.equal(formatPeriodicity('P3M'), 'every 3 months');
  assert.equal(formatPeriodicity('P1Y'), 'every 1 year');
  assert.equal(formatPeriodicity('P30D'), 'every 30 days');
  assert.equal(formatPeriodicity('nonsense'), 'nonsense');
});

test('humanizeToken reads underscore tokens', () => {
  assert.equal(humanizeToken('TO_RENEW'), 'To renew');
  assert.equal(humanizeToken('NO_EVIDENCE'), 'No evidence');
});
