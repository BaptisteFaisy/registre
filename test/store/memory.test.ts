/**
 * In-memory `StateStore` — round trip of every entity, filters, and the
 * type-validation memory of chapter 12.4 / EF-SUF-03.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeManifest, makeSignature } from '../fixtures/builders.ts';
import { InMemoryStateStore } from '../../src/store/memory.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';
import type { Pack, ReadinessTrendPoint, Reminder } from '../../src/domain/types.ts';
import {
  TEST_NOW,
  makeAttachment,
  makeControl,
  makeEvidence,
  makeFramework,
  makeSettings,
  makeStatus,
  makeSufficiency,
  makeValidation
} from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

function makeTrend(at: string, covered = 1): ReadinessTrendPoint {
  return {
    frameworkId: 'demo-msp',
    at,
    counts: { COVERED: covered, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 0 }
  };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rm-1',
    controlId: 'CONT-01',
    frameworkId: 'demo-msp',
    recipient: 'owner@msp.demo',
    reason: 'EXPIRING_SOON',
    missing: [],
    message: 'Evidence to renew',
    createdAt: TEST_NOW,
    expiresAt: '2026-12-01T00:00:00.000Z',
    status: 'SENT',
    channel: 'email',
    ...overrides
  };
}

function makePack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pk-1',
    frameworkId: 'demo-msp',
    frozenAt: TEST_NOW,
    index: [],
    knownGaps: [],
    archive: { uri: 'vault://packs/pk-1.zip', sha256: 'b'.repeat(64), sizeBytes: 1024 },
    manifest: makeManifest({ packId: 'pk-1' }),
    signature: makeSignature(),
    checksumsVerified: true,
    ...overrides
  };
}

test('frameworks: put, list and get round-trip', async () => {
  const store = new InMemoryStateStore({ clock });
  const framework = makeFramework();
  await store.putFramework(framework);
  assert.deepEqual(await store.getFramework(framework.id), framework);
  assert.deepEqual(await store.listFrameworks(), [framework]);
  assert.equal(await store.getFramework('missing'), null);
});

test('frameworks: a second import of the same id replaces the previous version', async () => {
  const store = new InMemoryStateStore({ clock });
  await store.putFramework(makeFramework({ version: '1.0' }));
  await store.putFramework(makeFramework({ version: '2.0' }));
  const frameworks = await store.listFrameworks();
  assert.equal(frameworks.length, 1);
  assert.equal(frameworks[0]?.version, '2.0');
});

test('controls: bulk put, framework listing and get', async () => {
  const store = new InMemoryStateStore({ clock });
  const first = makeControl({ id: 'CONT-02' });
  const second = makeControl({ id: 'CONT-01' });
  const other = makeControl({ id: 'CONT-09', frameworkId: 'iso-27001' });
  await store.putControls([first, second, other]);

  const listed = await store.listControls('demo-msp');
  assert.deepEqual(
    listed.map((control) => control.id),
    ['CONT-01', 'CONT-02']
  );
  assert.deepEqual(await store.getControl('CONT-01'), second);
  assert.equal(await store.getControl('CONT-99'), null);
});

test('evidence: round trip, duplicate lookup by fingerprint and filters', async () => {
  const store = new InMemoryStateStore({ clock });
  const older = makeEvidence({ id: 'ev-old', sha256: 'c'.repeat(64), ingestedAt: '2026-11-01T09:00:00.000Z' });
  const newer = makeEvidence({ id: 'ev-new', sha256: 'd'.repeat(64), ingestedAt: '2026-11-10T09:00:00.000Z' });
  await store.putEvidence(older);
  await store.putEvidence(newer);

  assert.deepEqual(await store.getEvidence('ev-new'), newer);
  assert.deepEqual(await store.findEvidenceByHash('d'.repeat(64)), newer);
  assert.equal(await store.findEvidenceByHash('e'.repeat(64)), null);

  const listed = await store.listEvidence();
  assert.deepEqual(
    listed.map((evidence) => evidence.id),
    ['ev-new', 'ev-old'],
    'most recently ingested first'
  );
  assert.equal((await store.listEvidence({ limit: 1 })).length, 1);
});

test('evidence: frameworkId filter follows the attachments (R8, chapter 14)', async () => {
  const store = new InMemoryStateStore({ clock });
  const attached = makeEvidence({ id: 'ev-attached' });
  const orphan = makeEvidence({ id: 'ev-orphan' });
  await store.putEvidence(attached);
  await store.putEvidence(orphan);
  await store.putAttachment(makeAttachment({ id: 'at-1', evidenceId: 'ev-attached', frameworkId: 'demo-msp' }));

  const scoped = await store.listEvidence({ frameworkId: 'demo-msp' });
  assert.deepEqual(
    scoped.map((evidence) => evidence.id),
    ['ev-attached']
  );
  assert.deepEqual(await store.listEvidence({ frameworkId: 'unknown' }), []);
});

test('attachments: filters on evidence, control and status', async () => {
  const store = new InMemoryStateStore({ clock });
  const applied = makeAttachment({ id: 'at-a', evidenceId: 'ev-1', controlId: 'CONT-01', status: 'APPLIED' });
  const proposed = makeAttachment({ id: 'at-b', evidenceId: 'ev-1', controlId: 'CONT-02', status: 'PROPOSED' });
  await store.putAttachment(applied);
  await store.putAttachment(proposed);

  assert.deepEqual(await store.getAttachment('at-a'), applied);
  assert.equal(await store.getAttachment('at-z'), null);
  assert.deepEqual((await store.listAttachments({ evidenceId: 'ev-1' })).length, 2);
  assert.deepEqual(
    (await store.listAttachments({ controlId: 'CONT-02' })).map((item) => item.id),
    ['at-b']
  );
  assert.deepEqual(
    (await store.listAttachments({ status: 'APPLIED' })).map((item) => item.id),
    ['at-a']
  );
});

test('sufficiency: one per attachment, plus control and evidence filters', async () => {
  const store = new InMemoryStateStore({ clock });
  const first = makeSufficiency({ id: 'sf-1', attachmentId: 'at-1', controlId: 'CONT-01', evidenceId: 'ev-1' });
  const second = makeSufficiency({
    id: 'sf-2',
    attachmentId: 'at-2',
    controlId: 'CONT-02',
    evidenceId: 'ev-2',
    computedAt: '2026-11-10T10:00:00.000Z'
  });
  await store.putSufficiency(first);
  await store.putSufficiency(second);

  assert.deepEqual(await store.getSufficiencyForAttachment('at-1'), first);
  assert.equal(await store.getSufficiencyForAttachment('at-9'), null);
  assert.deepEqual(
    (await store.listSufficiency({ controlId: 'CONT-02' })).map((item) => item.id),
    ['sf-2']
  );
  assert.deepEqual(
    (await store.listSufficiency({ evidenceId: 'ev-1' })).map((item) => item.id),
    ['sf-1']
  );
  assert.equal((await store.listSufficiency()).length, 2);
});

test('states: latest status wins, listing is scoped to the framework', async () => {
  const store = new InMemoryStateStore({ clock });
  await store.putStatus(makeStatus({ controlId: 'CONT-01', state: 'TO_VERIFY' }));
  await store.putStatus(makeStatus({ controlId: 'CONT-01', state: 'COVERED' }));
  await store.putStatus(makeStatus({ controlId: 'CONT-02', state: 'EXPIRED' }));
  await store.putStatus(makeStatus({ controlId: 'CONT-09', frameworkId: 'iso-27001' }));

  assert.equal((await store.getStatus('CONT-01'))?.state, 'COVERED');
  assert.equal(await store.getStatus('CONT-77'), null);
  assert.deepEqual(
    (await store.listStatuses('demo-msp')).map((status) => status.controlId),
    ['CONT-01', 'CONT-02']
  );
});

test('trend: points are kept in chronological order, latest N returned', async () => {
  const store = new InMemoryStateStore({ clock });
  await store.appendTrend(makeTrend('2026-11-03T00:00:00.000Z', 3));
  await store.appendTrend(makeTrend('2026-11-01T00:00:00.000Z', 1));
  await store.appendTrend(makeTrend('2026-11-02T00:00:00.000Z', 2));

  const all = await store.listTrend('demo-msp');
  assert.deepEqual(
    all.map((point) => point.at.slice(0, 10)),
    ['2026-11-01', '2026-11-02', '2026-11-03']
  );
  const latest = await store.listTrend('demo-msp', 2);
  assert.deepEqual(
    latest.map((point) => point.counts.COVERED),
    [2, 3]
  );
  assert.deepEqual(await store.listTrend('unknown'), []);
});

test('reminders: put, get and filters on control and status', async () => {
  const store = new InMemoryStateStore({ clock });
  const sent = makeReminder();
  const closed = makeReminder({ id: 'rm-2', controlId: 'CONT-02', status: 'CLOSED', createdAt: '2026-11-09T08:00:00.000Z' });
  await store.putReminder(sent);
  await store.putReminder(closed);

  assert.deepEqual(await store.getReminder('rm-1'), sent);
  assert.equal(await store.getReminder('rm-9'), null);
  assert.deepEqual(
    (await store.listReminders({ controlId: 'CONT-02' })).map((item) => item.id),
    ['rm-2']
  );
  assert.deepEqual(
    (await store.listReminders({ status: 'SENT' })).map((item) => item.id),
    ['rm-1']
  );
});

test('validations: queue filtered by status and kind', async () => {
  const store = new InMemoryStateStore({ clock });
  const pending = makeValidation({ id: 'va-1' });
  const decided = makeValidation({
    id: 'va-2',
    kind: 'UNREADABLE_EVIDENCE',
    status: 'DECIDED',
    decision: 'ACCEPT'
  });
  await store.putValidation(pending);
  await store.putValidation(decided);

  assert.deepEqual(await store.getValidation('va-1'), pending);
  assert.equal(await store.getValidation('va-9'), null);
  assert.deepEqual(
    (await store.listValidations({ status: 'PENDING' })).map((item) => item.id),
    ['va-1']
  );
  assert.deepEqual(
    (await store.listValidations({ kind: 'UNREADABLE_EVIDENCE' })).map((item) => item.id),
    ['va-2']
  );
});

test('packs: round trip and listing per framework', async () => {
  const store = new InMemoryStateStore({ clock });
  const pack = makePack();
  await store.putPack(pack);
  await store.putPack(makePack({ id: 'pk-2', frozenAt: '2026-11-05T00:00:00.000Z' }));
  await store.putPack(makePack({ id: 'pk-9', frameworkId: 'iso-27001' }));

  assert.deepEqual(await store.getPack('pk-1'), pack);
  assert.equal(await store.getPack('pk-9x'), null);
  assert.deepEqual(
    (await store.listPacks('demo-msp')).map((item) => item.id),
    ['pk-1', 'pk-2'],
    'most recently frozen first'
  );
});

test('settings: defaults before the first write, replacement afterwards', async () => {
  const store = new InMemoryStateStore({ clock });
  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);

  const custom = makeSettings({ confidenceThreshold: 0.7, reminderLeadDays: 45 });
  await store.putSettings(custom);
  assert.deepEqual(await store.getSettings(), custom);
});

test('markTypeValidated / isTypeValidated: human approval of a pair (EF-SUF-03)', async () => {
  const store = new InMemoryStateStore({ clock });
  assert.equal(await store.isTypeValidated('CONT-01', 'POLICY'), false);

  await store.markTypeValidated('CONT-01', 'POLICY', 'quality.lead');
  assert.equal(await store.isTypeValidated('CONT-01', 'POLICY'), true);
  assert.equal(
    await store.isTypeValidated('CONT-01', 'policy'),
    true,
    'the evidence type is normalised'
  );
  assert.equal(
    await store.isTypeValidated('CONT-02', 'POLICY'),
    false,
    'the approval is scoped to one control'
  );

  const recorded = store.listTypeValidations();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.validatedBy, 'quality.lead');
  assert.equal(recorded[0]?.validatedAt, TEST_NOW);
});

test('reads and writes are defensive: mutating a returned object changes nothing', async () => {
  const store = new InMemoryStateStore({ clock });
  const evidence = makeEvidence({ id: 'ev-safe' });
  await store.putEvidence(evidence);

  const read = await store.getEvidence('ev-safe');
  assert.ok(read !== null);
  read.fields.title = 'mutated';
  evidence.fields.title = 'mutated at the source';

  const reread = await store.getEvidence('ev-safe');
  assert.equal(reread?.fields.title, 'Information security policy');
});
