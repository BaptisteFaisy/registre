import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAPPING_FILTERS,
  confidenceColor,
  directionLabel,
  filterMappings,
  mappingConfidenceLabel,
  mappingStatusMeta,
  reuseFactorLabel,
  reuseSentence,
  reuseStats,
  sortMappings
} from './mappings.ts';
import type { ControlMapping, ReuseMetric } from '../api/types.ts';

function mapping(patch: Partial<ControlMapping> = {}): ControlMapping {
  return {
    id: 'mp-1',
    sourceFrameworkId: 'fw-msp-demo',
    sourceControlId: 'SEC-01',
    targetFrameworkId: 'fw-iso-demo',
    targetControlId: 'iso-a1',
    direction: 'SOURCE_TO_TARGET',
    confidence: 0.9,
    sourceQuote: 'review access rights',
    targetQuote: 'access rights shall be reviewed',
    reason: 'Both require a periodic access review.',
    status: 'PROPOSED',
    citationVerified: true,
    proposedBy: 'pipeline',
    proposedAt: '2026-11-01T08:00:00.000Z',
    ...patch
  };
}

function metric(patch: Partial<ReuseMetric> = {}): ReuseMetric {
  return {
    frameworkId: 'fw-msp-demo',
    computedAt: '2026-11-11T09:00:00.000Z',
    evidenceCount: 42,
    attachmentCount: 61,
    carriedAttachments: 12,
    avoidedDeposits: 9,
    reuseFactor: 1.45,
    validatedMappings: 3,
    pendingMappings: 2,
    ...patch
  };
}

test('the status filter keeps everything on ALL and only the status otherwise', () => {
  const all = [
    mapping({ id: 'a', status: 'PROPOSED' }),
    mapping({ id: 'b', status: 'VALIDATED' }),
    mapping({ id: 'c', status: 'REJECTED' })
  ];
  assert.equal(filterMappings(all).length, 3);
  assert.equal(filterMappings(all, 'ALL').length, 3);
  assert.deepEqual(
    filterMappings(all, 'PROPOSED').map((item) => item.id),
    ['a']
  );
  assert.deepEqual(
    filterMappings(all, 'VALIDATED').map((item) => item.id),
    ['b']
  );
  assert.equal(filterMappings(all, 'REJECTED').length, 1);
  assert.equal(MAPPING_FILTERS.length, 4);
});

test('sorting puts what waits for a human first, then the strongest confidence', () => {
  const sorted = sortMappings([
    mapping({ id: 'rej', status: 'REJECTED', confidence: 0.95 }),
    mapping({ id: 'val', status: 'VALIDATED', confidence: 0.99 }),
    mapping({ id: 'low', status: 'PROPOSED', confidence: 0.71 }),
    mapping({ id: 'high', status: 'PROPOSED', confidence: 0.88 })
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['high', 'low', 'val', 'rej']
  );
});

test('equal confidence falls back to the id so the list never wobbles', () => {
  const sorted = sortMappings([
    mapping({ id: 'b', confidence: 0.8 }),
    mapping({ id: 'a', confidence: 0.8 })
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['a', 'b']
  );
});

test('the reuse factor reads as attachments per deposited evidence', () => {
  assert.equal(reuseFactorLabel(1.4523), '1.45 attachments per evidence');
  assert.equal(reuseFactorLabel(Number.NaN), '—');
});

test('the reuse sentence carries every headline number', () => {
  const sentence = reuseSentence(metric());
  for (const part of ['61 attachments', '42 deposited', '12 attachment(s)', '9 new deposit(s)']) {
    assert.ok(sentence.includes(part), `missing "${part}"`);
  }
});

test('the banner stats expose the six counters in display order', () => {
  const stats = reuseStats(metric());
  assert.deepEqual(
    stats.map((item) => item.label),
    [
      'Reuse factor',
      'Deposits avoided',
      'Carried attachments',
      'Validated mappings',
      'Pending mappings',
      'Evidence deposited'
    ]
  );
  assert.equal(stats[0]?.value, '1.45');
  assert.equal(stats[1]?.value, '9');
});

test('confidence colours separate trusted, cautious and weak proposals', () => {
  assert.equal(confidenceColor(0.9), confidenceColor(0.85));
  assert.notEqual(confidenceColor(0.9), confidenceColor(0.75));
  assert.notEqual(confidenceColor(0.75), confidenceColor(0.6));
});

test('labels: statuses, direction and confidence read in plain English', () => {
  assert.equal(mappingStatusMeta('PROPOSED').label, 'Proposed');
  assert.equal(mappingStatusMeta('VALIDATED').label, 'Validated');
  assert.equal(mappingStatusMeta('REJECTED').label, 'Rejected');
  assert.equal(directionLabel('SOURCE_TO_TARGET'), 'source → target');
  assert.equal(directionLabel('TARGET_TO_SOURCE'), 'target → source');
  assert.equal(mappingConfidenceLabel(0.91), '91 %');
});
