/**
 * Weekly digest — EF-REL-03 (weekly point to the quality lead) and chapter 8.3
 * (what changed, what is missing, what waits for validation).
 *
 * The numbers come from the state engine; this module only formats them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeLines,
  digestBody,
  digestSubject,
  gapLines,
  readinessLines,
  validationLines,
  weeklyDigest
} from '../../src/notify/digest.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';
import type { ReadinessSnapshot, Reminder } from '../../src/domain/types.ts';
import {
  TEST_NOW,
  makeControl,
  makeFramework,
  makeStatus,
  makeValidation
} from '../fixtures/builders.ts';

function snapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    frameworkId: 'demo-msp',
    computedAt: TEST_NOW,
    total: 4,
    counts: { COVERED: 1, TO_RENEW: 1, TO_VERIFY: 1, EXPIRED: 0, NO_EVIDENCE: 1 },
    shares: { COVERED: 0.25, TO_RENEW: 0.25, TO_VERIFY: 0.25, EXPIRED: 0, NO_EVIDENCE: 0.25 },
    ...overrides
  };
}

const controls = [
  makeControl({ id: 'CONT-01', title: 'Information security policy reviewed annually', owner: 'quality.lead' }),
  makeControl({ id: 'CONT-02', title: 'Access review performed quarterly', owner: 'it.lead' }),
  makeControl({ id: 'CONT-03', title: 'Backup restore tested', owner: 'ops.lead' }),
  makeControl({ id: 'CONT-04', title: 'Incident post-mortem written', owner: 'ops.lead' })
];

const statuses = [
  makeStatus({ controlId: 'CONT-01', state: 'COVERED', expiresAt: '2027-08-01T00:00:00.000Z' }),
  makeStatus({ controlId: 'CONT-02', state: 'TO_RENEW', expiresAt: '2026-11-25T00:00:00.000Z' }),
  makeStatus({ controlId: 'CONT-03', state: 'TO_VERIFY', sufficiencyClass: 'PARTIAL', expiresAt: null }),
  makeStatus({ controlId: 'CONT-04', state: 'NO_EVIDENCE', freshness: 'UNDETERMINED', expiresAt: null })
];

const reminder: Reminder = {
  id: 'rm-1',
  controlId: 'CONT-02',
  frameworkId: 'demo-msp',
  recipient: 'it.lead@msp.demo',
  reason: 'EXPIRING_SOON',
  missing: [],
  message: 'Evidence to renew',
  createdAt: TEST_NOW,
  expiresAt: '2026-11-25T00:00:00.000Z',
  status: 'SENT',
  channel: 'email'
};

function input(overrides: Partial<Parameters<typeof digestBody>[0]> = {}) {
  return {
    recipient: 'quality@msp.demo',
    framework: makeFramework(),
    snapshot: snapshot(),
    previous: null,
    statuses,
    controls,
    validations: [
      makeValidation({ id: 'va-1', kind: 'ATTACHMENT', controlId: 'CONT-03', reason: 'confidence below threshold' }),
      makeValidation({ id: 'va-2', kind: 'UNREADABLE_EVIDENCE', evidenceId: 'ev-9', reason: 'unreadable scan' }),
      makeValidation({ id: 'va-3', kind: 'SUFFICIENCY', status: 'DECIDED', decision: 'ACCEPT' })
    ],
    reminders: [reminder],
    now: TEST_NOW,
    ...overrides
  };
}

test('subject: names the framework and the week (EF-REL-03)', () => {
  const subject = digestSubject(input());
  assert.match(subject, /^Weekly readiness digest — Demonstration framework/);
  assert.match(subject, /2026-11-11/);
});

test('readiness: one line per state, with counts and shares', () => {
  const lines = readinessLines(snapshot());
  assert.equal(lines.length, 5);
  assert.ok(lines.some((line) => line.includes('COVERED: 1 (25.0 %)')));
  assert.ok(lines.some((line) => line.includes('NO_EVIDENCE: 1')));
});

test('changes: deltas against the previous point, and a fallback without history', () => {
  assert.deepEqual(changeLines(snapshot(), null), ['  - no earlier point to compare with']);
  assert.deepEqual(changeLines(snapshot(), snapshot()), ['  - no change since the last point']);

  const previous = snapshot({
    counts: { COVERED: 3, TO_RENEW: 0, TO_VERIFY: 1, EXPIRED: 0, NO_EVIDENCE: 0 }
  });
  const lines = changeLines(snapshot(), previous);
  assert.ok(lines.includes('  - COVERED: -2'));
  assert.ok(lines.includes('  - NO_EVIDENCE: +1'));
});

test('gaps: only controls that are not covered, most urgent state first', () => {
  const lines = gapLines(input());
  const joined = lines.join('\n');

  assert.match(joined, /NO_EVIDENCE\] CONT-04/);
  assert.match(joined, /TO_RENEW\] CONT-02/);
  assert.match(joined, /TO_VERIFY\] CONT-03/);
  assert.doesNotMatch(joined, /CONT-01/);
  assert.ok(joined.indexOf('CONT-04') < joined.indexOf('CONT-02'), 'no evidence comes before to renew');
});

test('gaps: the list is bounded and says how many controls are left out', () => {
  const lines = gapLines(input({ maxItems: 2 }));
  assert.equal(lines.length, 3);
  assert.match(lines[2] ?? '', /and 1 more control/);
});

test('gaps: a framework with nothing missing says so', () => {
  const lines = gapLines(
    input({ statuses: [makeStatus({ controlId: 'CONT-01', state: 'COVERED' })] })
  );
  assert.deepEqual(lines, ['  - every control has a current evidence']);
});

test('validation: pending items are counted per kind and listed', () => {
  const lines = validationLines(input()).join('\n');
  assert.match(lines, /ATTACHMENT: 1/);
  assert.match(lines, /UNREADABLE_EVIDENCE: 1/);
  assert.doesNotMatch(lines, /SUFFICIENCY/, 'a decided item is not pending');
  assert.match(lines, /ATTACHMENT on CONT-03 — confidence below threshold/);
});

test('validation: an empty queue says nothing is waiting', () => {
  assert.deepEqual(validationLines(input({ validations: [] })), ['  - nothing waiting']);
});

test('body: assembles every section the quality lead needs (chapter 8.3)', () => {
  const body = digestBody(input({ previous: snapshot() }));

  assert.match(body, /Framework: Demonstration framework \(demo-msp, version 1.0\)/);
  assert.match(body, /Controls: 4/);
  assert.match(body, /Readiness:/);
  assert.match(body, /What changed since the last point:/);
  assert.match(body, /What is missing:/);
  assert.match(body, /Waiting for your validation:/);
  assert.match(body, /Reminders sent this week: 1/);
  assert.match(body, /Generated on 2026-11-11T12:00:00.000Z by Registre/);
});

test('body: the reminder count is omitted when no reminder was sent', () => {
  const body = digestBody(input({ reminders: [] }));
  assert.doesNotMatch(body, /Reminders sent this week/);
});

test('message: the digest is addressed to the quality lead and typed WEEKLY_DIGEST', () => {
  const message = weeklyDigest(input());
  assert.equal(message.to, 'quality@msp.demo');
  assert.equal(message.kind, 'WEEKLY_DIGEST');
  assert.ok(message.body.includes('What is missing:'));
});

test('wording: the digest never judges a control (ENF-IA-01)', () => {
  const body = digestBody(input({ previous: snapshot() }));
  assert.equal(containsForbiddenWord(body), false);
  assert.equal(containsForbiddenWord(digestSubject(input())), false);
});
