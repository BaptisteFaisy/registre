/**
 * Audit pack — EF-DOS-01/02/03, acceptance R14 ("index par contrôle, archive
 * téléchargeable, empreintes vérifiées").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestIsSelfConsistent } from '../../src/domain/manifest.ts';
import { assemblePack, verifyArchive } from '../../src/pipeline/pack.ts';
import { makeControl, makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from './fakeServices.ts';

const POLICY = makeControl({ id: 'CONT-01', mandatory: false, periodicity: 'P1Y' });
const BACKUP = makeControl({ id: 'CONT-03', mandatory: false, periodicity: 'P3M' });

/** Bundle with one covered control and one control without evidence. */
async function seeded() {
  const services = fakeServices();
  await seed(services, [POLICY, BACKUP]);
  const evidence = storedEvidence({ id: 'ev-1', sha256: 'b'.repeat(64) });
  await services.state.putEvidence(evidence);
  const attachment = pendingAttachment({
    id: 'at-1',
    status: 'APPLIED',
    controlId: 'CONT-01',
    evidenceId: 'ev-1',
    quote: 'reviewed on 1 August 2026 and approved by C. Bernard',
    quoteLocation: { page: 1 }
  });
  await services.state.putAttachment(attachment);
  await services.state.putSufficiency(
    makeSufficiency({ id: 'sf-1', attachmentId: 'at-1', evidenceId: 'ev-1', controlId: 'CONT-01', class: 'COMPLETE' })
  );
  return { services, evidence };
}

test('R14: the pack indexes every control with its state and its evidence', async () => {
  const { services } = await seeded();
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');

  assert.match(pack.id, /^pk-[0-9a-f]{12}$/);
  assert.equal(pack.frameworkId, 'demo-msp');
  assert.equal(pack.frozenAt, '2026-11-11T12:00:00.000Z');
  assert.equal(pack.index.length, 2);

  const covered = pack.index.find((entry) => entry.controlId === 'CONT-01');
  assert.equal(covered?.state, 'COVERED');
  assert.equal(covered?.controlTitle, POLICY.title);
  assert.equal(covered?.evidence.length, 1);
  assert.equal(covered?.evidence[0]?.sha256, 'b'.repeat(64));
  assert.equal(covered?.evidence[0]?.documentDate, '2026-08-01');
  assert.equal(covered?.evidence[0]?.sufficiencyClass, 'COMPLETE');
  assert.equal(covered?.evidence[0]?.page, 1);
  assert.match(covered?.evidence[0]?.quote ?? '', /approved by C\. Bernard/);
});

test('R14: the known gaps travel with the pack, the covered controls do not', async () => {
  const { services } = await seeded();
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');

  assert.deepEqual(pack.knownGaps.map((gap) => gap.controlId), ['CONT-03']);
  assert.equal(pack.knownGaps[0]?.state, 'NO_EVIDENCE');
  assert.match(pack.knownGaps[0]?.detail ?? '', /no applied evidence/);
});

test('R14: the archive is written to the vault and its fingerprints are verified', async () => {
  const { services } = await seeded();
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');

  assert.equal(pack.checksumsVerified, true);
  assert.match(pack.archive.uri, new RegExp(`^vault://packs/${pack.id}/index\\.json#v1$`));
  assert.equal(pack.archive.sha256.length, 64);
  assert.ok(pack.archive.sizeBytes > 0);
  assert.deepEqual(services.vaultKeys(), [
    `vault://packs/${pack.id}/index.json#v1`,
    `vault://packs/${pack.id}/manifest.json#v1`,
    `vault://packs/${pack.id}/attestation.json#v1`
  ]);
  // The pack carries a canonical manifest and its signature: that is what a
  // third party verifies offline (scripts/verify-pack.sh), never the content.
  assert.equal(pack.manifest.rootHash.length, 64);
  assert.equal(manifestIsSelfConsistent(pack.manifest), true);
  assert.ok(pack.signature !== null, 'a signed pack reports its signature');
  assert.equal(pack.signature?.rootHash, pack.manifest.rootHash);
  const index = JSON.parse(new TextDecoder().decode(await services.evidenceStore.get(pack.archive.uri)));
  assert.equal(index.index.length, 2, 'the archive carries a readable index');
  assert.equal(index.knownGaps.length, 1);
});

test('a tampered archive is reported as unverified', async () => {
  const { services } = await seeded();
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');
  services.corruptObject(pack.archive.uri);

  assert.equal((await services.evidenceStore.get(pack.archive.uri).catch(() => null)) === null, true);
  const reread = await verifyArchive(services, pack.archive.uri, pack.archive.sha256);
  assert.equal(reread, false, 'the fingerprint no longer matches the bytes');
});

test('the pack is persisted, journalled and can be read back', async () => {
  const { services } = await seeded();
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');

  assert.equal((await services.state.getPack(pack.id))?.id, pack.id);
  assert.equal((await services.state.listPacks('demo-msp')).length, 1);
  const event = services.events('PACK_ASSEMBLED')[0];
  assert.equal(event?.actor, 'quality.lead');
  assert.equal(event?.detail.controls, 2);
  assert.equal(event?.detail.knownGaps, 1);
  assert.equal(event?.detail.checksumsVerified, true);
});

test('an unknown framework cannot be packed', async () => {
  const services = fakeServices();
  await assert.rejects(() => assemblePack(services, 'missing', 'quality.lead'), { code: 'NOT_FOUND' });
});
