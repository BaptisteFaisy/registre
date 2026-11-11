import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDuration,
  buildTrend,
  computeByDomain,
  computeCosts,
  computeSnapshot,
  computeStatus,
  expiryOf,
  freshnessOf
} from './engine.ts';
import type { Attachment, Control, Evidence, Sufficiency } from '../api/types.ts';

const NOW = '2026-11-11T09:00:00.000Z';

const control: Control = {
  id: 'BCP-02',
  frameworkId: 'fw-demo',
  domain: 'Continuity',
  title: 'Backup restore test',
  requirement: 'A restore test is run every quarter.',
  expectedEvidence: ['test date', 'measured recovery time'],
  periodicity: 'P3M',
  owner: 'Kwame Mensah',
  mandatory: true
};

function evidence(documentDate: string, approver: string | null = 'Claire Fontaine'): Evidence {
  return {
    id: 'ev-1',
    sha256: 'a'.repeat(64),
    revision: 1,
    fields: {
      type: 'REPORT',
      title: 'Restore test',
      documentDate,
      period: { start: null, end: null },
      version: null,
      author: 'Kwame Mensah',
      approver,
      approvalDate: approver ? documentDate : null,
      client: null,
      summary: null,
      personalData: false
    },
    flags: { unreadable: false, missingDate: false, missingAuthor: false, dateToConfirm: false },
    accessLevel: 'INTERNAL',
    locations: [{ kind: 'S3', uri: 's3://vault/ev-1.pdf', collectedAt: `${documentDate}T06:00:00.000Z` }],
    textPages: [{ page: 1, text: 'Measured recovery time: 3 h 05. Result: successful.' }],
    sizeBytes: 1024,
    contentType: 'application/pdf',
    ingestedAt: `${documentDate}T06:15:00.000Z`,
    reader: 'bedrock-data-automation',
    cost: { usd: 0.03, tokensIn: 100, tokensOut: 10, source: 'bedrock-data-automation' }
  };
}

function attachment(status: Attachment['status'] = 'APPLIED', confidence = 0.93): Attachment {
  return {
    id: 'at-1',
    evidenceId: 'ev-1',
    controlId: control.id,
    frameworkId: control.frameworkId,
    supports: true,
    confidence,
    quote: 'Measured recovery time: 3 h 05.',
    quoteLocation: { page: 1 },
    reason: 'The report states the expectation.',
    status,
    citationVerified: true,
    autoApplied: true,
    model: 'structured-output-reasoner',
    createdAt: '2026-08-10T07:20:00.000Z'
  };
}

function sufficiency(klass: Sufficiency['class'], missing: string[] = []): Sufficiency {
  return {
    id: 'sf-1',
    attachmentId: 'at-1',
    evidenceId: 'ev-1',
    controlId: control.id,
    elements: control.expectedEvidence.map((expected) => ({
      expected,
      present: !missing.includes(expected),
      quote: missing.includes(expected) ? null : 'Measured recovery time: 3 h 05.'
    })),
    class: klass,
    missing,
    computedAt: NOW
  };
}

test('addDuration adds months, days and years to an ISO date', () => {
  assert.equal(addDuration('2026-01-31', 'P1M')?.slice(0, 10), '2026-03-03');
  assert.equal(addDuration('2026-02-10', 'P30D')?.slice(0, 10), '2026-03-12');
  assert.equal(addDuration('2026-02-10', 'P1Y')?.slice(0, 10), '2027-02-10');
  assert.equal(addDuration('2026-02-10', 'nonsense'), null);
});

test('freshness compares the expiry with the renewal lead time', () => {
  assert.equal(freshnessOf('2026-12-31T00:00:00.000Z', NOW, 30), 'FRESH');
  assert.equal(freshnessOf('2026-11-20T00:00:00.000Z', NOW, 30), 'TO_RENEW');
  assert.equal(freshnessOf('2026-11-01T00:00:00.000Z', NOW, 30), 'EXPIRED');
  assert.equal(freshnessOf(null, NOW, 30), 'UNDETERMINED');
});

test('expiryOf uses the covered period end when the document has one', () => {
  const ev = evidence('2026-10-01');
  ev.fields.period = { start: '2026-07-01', end: '2026-09-30' };
  assert.equal(expiryOf(ev, control)?.slice(0, 10), '2026-12-30');
});

test('a fresh, complete, signed evidence gives a covered control', () => {
  const status = computeStatus({
    control,
    attachments: [attachment()],
    sufficiencies: [sufficiency('COMPLETE')],
    evidenceById: new Map([['ev-1', evidence('2026-10-20')]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(status.state, 'COVERED');
  assert.equal(status.sufficiencyClass, 'COMPLETE');
  assert.equal(status.notes.length, 0);
});

test('a partial sufficiency pushes the control to "to verify"', () => {
  const status = computeStatus({
    control,
    attachments: [attachment()],
    sufficiencies: [sufficiency('PARTIAL', ['measured recovery time'])],
    evidenceById: new Map([['ev-1', evidence('2026-10-20')]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(status.state, 'TO_VERIFY');
  assert.ok(status.notes.includes('partial-sufficiency'));
});

test('an unsigned document pushes the control to "to verify"', () => {
  const status = computeStatus({
    control,
    attachments: [attachment()],
    sufficiencies: [sufficiency('COMPLETE')],
    evidenceById: new Map([['ev-1', evidence('2026-10-20', null)]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(status.state, 'TO_VERIFY');
  assert.ok(status.notes.includes('document-not-signed'));
});

test('an expiring evidence gives "to renew", an expired one "expired"', () => {
  const renew = computeStatus({
    control,
    attachments: [attachment()],
    sufficiencies: [sufficiency('COMPLETE')],
    evidenceById: new Map([['ev-1', evidence('2026-09-01')]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(renew.state, 'TO_RENEW');

  const expired = computeStatus({
    control,
    attachments: [attachment()],
    sufficiencies: [sufficiency('COMPLETE')],
    evidenceById: new Map([['ev-1', evidence('2026-06-01')]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(expired.state, 'EXPIRED');
  assert.ok(expired.notes.includes('every-applied-evidence-expired'));
});

test('only proposed attachments means "to verify", none at all "no evidence"', () => {
  const proposed = computeStatus({
    control,
    attachments: [attachment('PROPOSED', 0.6)],
    sufficiencies: [sufficiency('COMPLETE')],
    evidenceById: new Map([['ev-1', evidence('2026-10-20')]]),
    now: NOW,
    leadDays: 30
  });
  assert.equal(proposed.state, 'TO_VERIFY');
  assert.equal(proposed.pendingProposals, 1);

  const none = computeStatus({
    control,
    attachments: [],
    sufficiencies: [],
    evidenceById: new Map(),
    now: NOW,
    leadDays: 30
  });
  assert.equal(none.state, 'NO_EVIDENCE');
  assert.equal(none.bestEvidenceId, null);
});

test('the snapshot shares always sum to one', () => {
  const statuses = computeStatuses();
  const snapshot = computeSnapshot('fw-demo', statuses, NOW);
  assert.equal(snapshot.total, 3);
  const total = Object.values(snapshot.shares).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.001, `shares sum to ${total}`);
});

test('the domain breakdown keeps every control', () => {
  const byDomain = computeByDomain(
    [control, { ...control, id: 'BCP-03', domain: 'Security' }],
    computeStatuses()
  );
  assert.equal(byDomain.Continuity?.total, 1);
  assert.equal(byDomain.Security?.total, 1);
});

test('the trend has six points and ends on the current snapshot', () => {
  const snapshot = computeSnapshot('fw-demo', computeStatuses(), NOW);
  const trend = buildTrend(snapshot, NOW);
  assert.equal(trend.length, 6);
  assert.deepEqual(trend[5]?.counts, snapshot.counts);
  assert.ok((trend[0]?.counts.COVERED ?? 0) <= snapshot.counts.COVERED);
});

test('cost per evidence is the total divided by the count', () => {
  const report = computeCosts([evidence('2026-10-20'), evidence('2026-09-20')]);
  assert.equal(report.evidenceCount, 2);
  assert.equal(report.totalUsd, 0.06);
  assert.equal(report.perEvidenceUsd, 0.03);
  assert.deepEqual(Object.keys(report.bySource), ['bedrock-data-automation']);
});

/** Three statuses of the same framework, used by the aggregate tests. */
function computeStatuses() {
  const base = { sufficiencies: [sufficiency('COMPLETE')], now: NOW, leadDays: 30 };
  return [
    computeStatus({
      ...base,
      control,
      attachments: [attachment()],
      evidenceById: new Map([['ev-1', evidence('2026-10-20')]])
    }),
    computeStatus({
      ...base,
      control: { ...control, id: 'BCP-03' },
      attachments: [],
      evidenceById: new Map()
    }),
    computeStatus({
      ...base,
      control: { ...control, id: 'BCP-04' },
      attachments: [attachment('PROPOSED', 0.6)],
      evidenceById: new Map([['ev-1', evidence('2026-10-20')]])
    })
  ];
}
