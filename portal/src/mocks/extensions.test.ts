import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ISO_FRAMEWORK_ID,
  TAMPERED_PACK_ID,
  buildDrifts,
  buildDraft,
  buildMappings,
  buildQuality,
  buildReuse,
  buildShares,
  draftSections,
  thresholdInEffectOf,
  verificationOf,
  verdictOf
} from './extensions.ts';
import { buildPack } from './activity.ts';
import { createDb } from './dataset.ts';
import { shareState } from '../lib/verify.ts';
import { NOW } from './evidence.ts';
import { DRAFT_WATERMARK } from '../api/types.ts';
import type { QualitySubjectRow } from '../api/types.ts';

const db = createDb();

test('the clean pack verifies with every verdict passing', () => {
  const result = verificationOf(buildPack(db));
  assert.equal(result.packId, 'pk-001');
  assert.equal(result.checksumsOk, true);
  assert.equal(result.chainOk, true);
  assert.equal(result.signatureOk, true);
  assert.equal(result.algorithm, 'ED25519-LOCAL');
  assert.match(result.rootHash, /^[0-9a-f]{64}$/);
  assert.equal(result.controlCount, 30);
  assert.ok(result.evidenceCount > 0);
  assert.equal(result.verifiedAt, NOW);
});

test('the seeded altered pack fails its checksums only', () => {
  const result = verificationOf(buildPack(db, TAMPERED_PACK_ID, '2026-10-15T18:00:00.000Z'));
  assert.equal(result.packId, TAMPERED_PACK_ID);
  assert.equal(result.checksumsOk, false);
  assert.equal(result.chainOk, true);
  assert.equal(result.signatureOk, true);
});

test('verification is deterministic: same pack, same result', () => {
  const pack = buildPack(db);
  assert.deepEqual(verificationOf(pack), verificationOf(pack));
});

test('three shares are seeded: one active, one expired, one revoked', () => {
  const shares = buildShares();
  assert.equal(shares.length, 3);
  const states = shares.map((share) => shareState(share, NOW));
  assert.deepEqual(states, ['ACTIVE', 'EXPIRED', 'REVOKED']);
  assert.ok(shares.every((share) => share.watermark.startsWith('AUDITOR ')));
  assert.ok(shares.every((share) => share.token.length === 43));
  assert.deepEqual(buildShares(), shares);
});

test('six mappings are seeded, two of them waiting for a decision', () => {
  const mappings = buildMappings();
  assert.equal(mappings.length, 6);
  assert.equal(mappings.filter((item) => item.status === 'PROPOSED').length, 2);
  assert.equal(mappings.filter((item) => item.status === 'VALIDATED').length, 3);
  assert.equal(mappings.filter((item) => item.status === 'REJECTED').length, 1);
  assert.ok(mappings.every((item) => item.citationVerified));
  assert.ok(mappings.every((item) => item.targetFrameworkId === ISO_FRAMEWORK_ID));
  assert.equal(new Set(mappings.map((item) => item.id)).size, 6);
  assert.deepEqual(buildMappings(), mappings);
});

test('the reuse factor is attachments divided by evidence, rounded to 2', () => {
  const reuse = buildReuse(buildMappings());
  assert.equal(reuse.reuseFactor, Math.round((61 / 42) * 100) / 100);
  assert.equal(reuse.validatedMappings, 3);
  assert.equal(reuse.pendingMappings, 2);
  assert.ok(reuse.avoidedDeposits > 0);
});

test('the reuse metric counts mappings live', () => {
  const mappings = buildMappings();
  const proposed = mappings.find((item) => item.status === 'PROPOSED');
  assert.ok(proposed);
  proposed.status = 'VALIDATED';
  const reuse = buildReuse(mappings);
  assert.equal(reuse.validatedMappings, 4);
  assert.equal(reuse.pendingMappings, 1);
});

test('five drifts are seeded, three of them unacknowledged', () => {
  const drifts = buildDrifts();
  assert.equal(drifts.length, 5);
  assert.equal(drifts.filter((item) => item.acknowledgedAt === null).length, 3);
  const kinds = new Set(drifts.map((item) => item.kind));
  assert.deepEqual(
    [...kinds].sort(),
    ['MISSING_RUN', 'RECOVERED', 'STATE_CHANGED', 'THRESHOLD_CROSSED']
  );
  assert.ok(drifts.every((item) => item.detail.length > 20));
  assert.ok(
    drifts.every((item) =>
      db.controls.some((control) => control.id === item.controlId)
    )
  );
});

test('draft sections: present elements carry a quote, missing ones stay empty', () => {
  const carried = {
    evidence: db.evidence[0]!,
    sufficiency: {
      elements: [
        { expected: 'a', present: true, quote: 'the quote' },
        { expected: 'b', present: false, quote: null }
      ]
    } as never
  };
  const sections = draftSections(['a', 'b', 'c'], carried);
  assert.deepEqual(
    sections.map((section) => section.toComplete),
    [false, true, true]
  );
  assert.equal(sections[0]?.body, 'the quote');
  assert.deepEqual(draftSections(['a'], null).map((section) => section.toComplete), [true]);
});

test('the seeded draft of the outdated security policy has two sections to complete', () => {
  const draft = buildDraft(db, 'SEC-01');
  assert.ok(draft);
  assert.equal(draft.controlId, 'SEC-01');
  assert.equal(draft.format, 'MARKDOWN');
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.attachable, false);
  assert.equal(draft.watermark, DRAFT_WATERMARK);
  assert.equal(draft.sections.length, 5);
  assert.deepEqual(draft.missing, ['review date', 'employee acknowledgement']);
  assert.deepEqual(draft.basedOn, ['ev-024']);
  assert.ok(draft.content.includes(DRAFT_WATERMARK));
  assert.ok(draft.content.includes('_To complete: review date._'));
  assert.ok(draft.content.includes('## Signature'));
  assert.deepEqual(buildDraft(db, 'SEC-01'), draft);
});

test('a control without applied evidence yields a draft with everything to complete', () => {
  const draft = buildDraft(db, 'CHG-03');
  assert.ok(draft);
  assert.equal(draft.basedOn.length, 0);
  assert.equal(draft.sections.length, 4);
  assert.ok(draft.sections.every((section) => section.toComplete));
});

test('an unknown control has no draft', () => {
  assert.equal(buildDraft(db, 'NOPE-99'), null);
});

function acceptedRow(verdict: QualitySubjectRow['verdict'], value: number): QualitySubjectRow {
  return {
    subject: { kind: 'ATTACHMENT', modelId: 'm', promptVersion: 'v1' },
    metric: 'ACCEPTED_WITHOUT_CORRECTION',
    value,
    target: 0.9,
    verdict,
    trend: [value],
    measuredAt: '2026-11-10T02:00:00.000Z'
  };
}

test('the threshold rule: a failing attachment measurement pushes it above 1', () => {
  assert.equal(thresholdInEffectOf(0.85, []), 0.85);
  assert.equal(thresholdInEffectOf(0.85, [acceptedRow('PASS', 0.93)]), 0.85);
  assert.equal(thresholdInEffectOf(0.85, [acceptedRow('FAIL', 0.81)]), 1.01);
});

test('the verdict is computed by code from value, target and direction', () => {
  assert.equal(verdictOf('FIELD_ACCURACY', 0.96, 0.95), 'PASS');
  assert.equal(verdictOf('FIELD_ACCURACY', 0.9, 0.95), 'FAIL');
  assert.equal(verdictOf('INVENTED_ANSWERS', 0, 0), 'PASS');
  assert.equal(verdictOf('INVENTED_ANSWERS', 2, 0), 'FAIL');
});

test('the seeded report shows one metric below target and the all-human threshold', () => {
  const report = buildQuality(0.85);
  assert.equal(report.subjects.length, 6);
  const failing = report.subjects.filter((row) => row.verdict === 'FAIL');
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.metric, 'ACCEPTED_WITHOUT_CORRECTION');
  assert.equal(report.thresholdInEffect, 1.01);
  assert.equal(report.trend.length, 6 * 3);
  assert.ok(report.subjects.every((row) => row.trend.length === 3));
  assert.deepEqual(buildQuality(0.85), report);
});
