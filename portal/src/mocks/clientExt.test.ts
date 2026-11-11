/**
 * Contract tests of the thirteen extension methods on the mock client: the
 * shapes they answer, the demo situations they serve and the guard rails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MockRegistreApi } from './client.ts';
import { DEMO_ACCOUNTS } from './principals.ts';
import { ApiError } from '../api/client.ts';
import { shareState } from '../lib/verify.ts';
import { DEMO_FRAMEWORK_ID } from './framework.ts';
import { ISO_FRAMEWORK_ID, TAMPERED_PACK_ID } from './extensions.ts';
import { NOW } from './evidence.ts';
import { DRAFT_WATERMARK } from '../api/types.ts';
import type { Principal } from '../api/types.ts';

const qualityLead = principalOf('QUALITY_LEAD');

function principalOf(role: Principal['role']): Principal {
  const account = DEMO_ACCOUNTS.find((item) => item.principal.role === role);
  assert.ok(account, `no demo account for ${role}`);
  return account.principal;
}

function api(): MockRegistreApi {
  return new MockRegistreApi(() => qualityLead);
}

test('verifyPack answers the full contract shape for the clean pack', async () => {
  const result = await api().verifyPack('pk-001');
  assert.equal(result.packId, 'pk-001');
  assert.equal(result.frameworkId, DEMO_FRAMEWORK_ID);
  assert.equal(result.verifiedAt, NOW);
  assert.match(result.rootHash, /^[0-9a-f]{64}$/);
  assert.equal(result.controlCount, 30);
  assert.ok(result.evidenceCount > 0);
  assert.ok(result.knownGapCount > 0);
  assert.equal(result.checksumsOk, true);
  assert.equal(result.chainOk, true);
  assert.equal(result.signatureOk, true);
  assert.equal(result.signerKeyId, 'local-key-ed25519-01');
  assert.equal(result.algorithm, 'ED25519-LOCAL');
});

test('verifyPack exposes the seeded altered archive through its checksums', async () => {
  const result = await api().verifyPack(TAMPERED_PACK_ID);
  assert.equal(result.checksumsOk, false);
  assert.equal(result.signatureOk, true);
});

test('verifying an unknown pack is a 404, and every verification is journalled', async () => {
  await assert.rejects(
    () => api().verifyPack('pk-999'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
  const events = await api().listAuditLog({ action: 'PACK_VERIFIED', limit: 10 });
  assert.ok(events.length > 0);
});

test('verifyByToken serves the auditor side and bumps the use counter', async () => {
  const client = api();
  const shares = await client.listShares();
  const active = shares.find((share) => shareState(share, NOW) === 'ACTIVE');
  assert.ok(active);
  const before = active.useCount;
  const result = await client.verifyByToken(active.token);
  assert.equal(result.packId, 'pk-001');
  const after = await client.listShares();
  const bumped = after.find((share) => share.token === active.token);
  assert.equal(bumped?.useCount, before + 1);
  assert.equal(bumped?.lastUsedAt, NOW);
});

test('a revoked, expired or unknown token cannot verify anything', async () => {
  const client = api();
  const shares = await client.listShares();
  for (const state of ['REVOKED', 'EXPIRED'] as const) {
    const share = shares.find((item) => shareState(item, NOW) === state);
    assert.ok(share, `no ${state} share seeded`);
    await assert.rejects(
      () => client.verifyByToken(share.token),
      (error: unknown) => error instanceof ApiError && error.status === 404
    );
  }
  await assert.rejects(
    () => client.verifyByToken('not-a-token'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('createShare builds a bounded, watermarked grant', async () => {
  const grant = await api().createShare('pk-001', {
    ttlHours: 24,
    watermarkLabel: 'Test audit firm'
  });
  assert.equal(grant.packId, 'pk-001');
  assert.equal(grant.scope, 'PACK');
  assert.equal(grant.createdBy, qualityLead.name);
  assert.equal(grant.createdAt, NOW);
  assert.equal(grant.expiresAt, '2026-11-12T09:00:00.000Z');
  assert.equal(grant.watermark, 'AUDITOR Test audit firm · expires 12 Nov 2026');
  assert.equal(grant.useCount, 0);
  assert.equal(grant.revokedAt, null);
  assert.equal(grant.token.length, 43);
  const shares = await api().listShares();
  assert.ok(shares.some((item) => item.token === grant.token));
});

test('createShare refuses a lifetime out of 1..168 hours or an empty label', async () => {
  const client = api();
  for (const ttlHours of [0, 169, 2.5]) {
    await assert.rejects(
      () => client.createShare('pk-001', { ttlHours, watermarkLabel: 'Auditor' }),
      (error: unknown) => error instanceof ApiError && error.status === 400
    );
  }
  await assert.rejects(
    () => client.createShare('pk-001', { ttlHours: 24, watermarkLabel: '  ' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
  await assert.rejects(
    () => client.createShare('pk-999', { ttlHours: 24, watermarkLabel: 'Auditor' }),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('revokeShare closes the grant once, and only once', async () => {
  const client = api();
  const grant = await client.createShare('pk-001', { ttlHours: 8, watermarkLabel: 'Temp reviewer' });
  const revoked = await client.revokeShare(grant.token);
  assert.equal(revoked.revokedAt, NOW);
  assert.equal(revoked.revokedBy, qualityLead.name);
  assert.equal(shareState(revoked, NOW), 'REVOKED');
  await assert.rejects(
    () => client.revokeShare(grant.token),
    (error: unknown) => error instanceof ApiError && error.status === 409
  );
  await assert.rejects(
    () => client.revokeShare('not-a-token'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('listMappings answers six seeded correspondences, filterable by status', async () => {
  const client = api();
  const all = await client.listMappings();
  assert.equal(all.length, 6);
  assert.equal(all[0]?.status, 'PROPOSED');
  const proposed = await client.listMappings({ status: 'PROPOSED' });
  assert.equal(proposed.length, 2);
  assert.ok(proposed.every((item) => item.status === 'PROPOSED'));
  const byFramework = await client.listMappings({ targetFrameworkId: ISO_FRAMEWORK_ID });
  assert.equal(byFramework.length, 6);
  assert.ok(all.every((item) => item.sourceQuote.length > 0 && item.targetQuote.length > 0));
});

test('proposeMappings returns the proposals of the pair and refuses a self-map', async () => {
  const client = api();
  const proposed = await client.proposeMappings({
    sourceFrameworkId: DEMO_FRAMEWORK_ID,
    targetFrameworkId: ISO_FRAMEWORK_ID
  });
  assert.equal(proposed.length, 2);
  assert.ok(proposed.every((item) => item.status === 'PROPOSED'));
  await assert.rejects(
    () =>
      client.proposeMappings({
        sourceFrameworkId: DEMO_FRAMEWORK_ID,
        targetFrameworkId: DEMO_FRAMEWORK_ID
      }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test('decideMapping records author, date and mandatory reason', async () => {
  const client = api();
  const proposed = await client.listMappings({ status: 'PROPOSED' });
  assert.equal(proposed.length, 2);
  const first = proposed[0];
  assert.ok(first);
  const validated = await client.decideMapping(first.id, 'VALIDATE', 'Quotes checked by hand.');
  assert.equal(validated.status, 'VALIDATED');
  assert.equal(validated.validatedBy, qualityLead.name);
  assert.equal(validated.validatedAt, NOW);
  assert.equal(validated.note, 'Quotes checked by hand.');
  await assert.rejects(
    () => client.decideMapping(first.id, 'REJECT', 'Already decided.'),
    (error: unknown) => error instanceof ApiError && error.status === 409
  );
});

test('decideMapping needs a reason and a known mapping', async () => {
  const client = api();
  await assert.rejects(
    () => client.decideMapping('mp-unknown', 'VALIDATE', 'no such mapping'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
  const proposed = await client.listMappings({ status: 'PROPOSED' });
  const second = proposed[0];
  assert.ok(second);
  await assert.rejects(
    () => client.decideMapping(second.id, 'REJECT', 'x'),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
  const rejected = await client.decideMapping(second.id, 'REJECT', 'Subjects differ.');
  assert.equal(rejected.status, 'REJECTED');
});

test('getReuse answers the contract shape and counts decisions live', async () => {
  const reuse = await api().getReuse(DEMO_FRAMEWORK_ID);
  assert.equal(reuse.frameworkId, DEMO_FRAMEWORK_ID);
  assert.equal(reuse.reuseFactor, Math.round((reuse.attachmentCount / reuse.evidenceCount) * 100) / 100);
  assert.equal(reuse.validatedMappings, 4);
  assert.equal(reuse.pendingMappings, 0);
  await assert.rejects(
    () => api().getReuse('fw-unknown'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('listDrifts answers the five seeded drifts, newest first', async () => {
  const drifts = await api().listDrifts(DEMO_FRAMEWORK_ID);
  assert.equal(drifts.length, 5);
  for (let index = 1; index < drifts.length; index += 1) {
    assert.ok((drifts[index - 1]?.detectedAt ?? '') >= (drifts[index]?.detectedAt ?? ''));
  }
  assert.equal(drifts.filter((item) => item.acknowledgedAt === null).length, 3);
  assert.equal((await api().listDrifts('fw-unknown')).length, 0);
});

test('ackDrift keeps author and date, and refuses a second acknowledgement', async () => {
  const client = api();
  const open = (await client.listDrifts()).find((item) => item.acknowledgedAt === null);
  assert.ok(open);
  const acked = await client.ackDrift(open.id);
  assert.equal(acked.acknowledgedAt, NOW);
  assert.equal(acked.acknowledgedBy, qualityLead.name);
  await assert.rejects(
    () => client.ackDrift(open.id),
    (error: unknown) => error instanceof ApiError && error.status === 409
  );
  await assert.rejects(
    () => client.ackDrift('dr-unknown'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('generateDraft answers a watermarked, non-attachable markdown draft', async () => {
  const draft = await api().generateDraft('SEC-01');
  assert.equal(draft.controlId, 'SEC-01');
  assert.equal(draft.watermark, DRAFT_WATERMARK);
  assert.equal(draft.attachable, false);
  assert.equal(draft.format, 'MARKDOWN');
  assert.equal(draft.sections.length, 5);
  assert.equal(draft.sections.filter((section) => section.toComplete).length, 2);
  assert.ok(draft.content.includes(DRAFT_WATERMARK));
  await assert.rejects(
    () => api().generateDraft('NOPE-99'),
    (error: unknown) => error instanceof ApiError && error.status === 404
  );
});

test('getQuality shows the seeded degradation and the all-human threshold', async () => {
  const report = await api().getQuality();
  assert.equal(report.subjects.length, 6);
  assert.equal(report.thresholdInEffect, 1.01);
  const failing = report.subjects.filter((row) => row.verdict === 'FAIL');
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.metric, 'ACCEPTED_WITHOUT_CORRECTION');
  assert.ok(report.trend.length >= report.subjects.length);
});

test('the extension writes are journalled in the audit trail', async () => {
  const client = api();
  for (const action of ['SHARE_CREATED', 'SHARE_REVOKED', 'MAPPING_DECIDED', 'DRIFT_ACKNOWLEDGED', 'DRAFT_GENERATED']) {
    const events = await client.listAuditLog({ action, limit: 5 });
    assert.ok(events.length > 0, `no audit event for ${action}`);
  }
});

test('every extension method refuses an anonymous caller with 401', async () => {
  const anonymous = new MockRegistreApi(() => null);
  const calls = [
    () => anonymous.verifyPack('pk-001'),
    () => anonymous.createShare('pk-001', { ttlHours: 24, watermarkLabel: 'Auditor' }),
    () => anonymous.listShares(),
    () => anonymous.revokeShare('tok'),
    () => anonymous.listMappings(),
    () => anonymous.proposeMappings({ sourceFrameworkId: 'a', targetFrameworkId: 'b' }),
    () => anonymous.decideMapping('mp', 'VALIDATE', 'note'),
    () => anonymous.getReuse(DEMO_FRAMEWORK_ID),
    () => anonymous.listDrifts(),
    () => anonymous.ackDrift('dr'),
    () => anonymous.generateDraft('SEC-01'),
    () => anonymous.getQuality()
  ];
  for (const call of calls) {
    await assert.rejects(
      call,
      (error: unknown) => error instanceof ApiError && error.status === 401
    );
  }
});
