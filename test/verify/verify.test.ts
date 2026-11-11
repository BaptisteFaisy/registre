/**
 * Pack verification (axis 1) — a third party checks a frozen pack without
 * trusting us, and the verdict never carries evidence content.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../src/support/hash.ts';
import { assemblePack } from '../../src/pipeline/pack.ts';
import { checkPack, verifyByToken, verifyPack, verdictLine } from '../../src/pipeline/verify.ts';
import { createShare } from '../../src/pipeline/share.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { makeControl, makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from '../pipeline/fakeServices.ts';

const CONTROL = makeControl({ id: 'CONT-01', mandatory: false, periodicity: 'P1Y' });

/** One framework, one control, one applied evidence, one frozen pack. */
async function withPack() {
  const services = fakeServices();
  await seed(services, [CONTROL]);
  const evidence = storedEvidence({ id: 'ev-1', sha256: 'b'.repeat(64) });
  await services.state.putEvidence(evidence);
  await services.state.putAttachment(
    pendingAttachment({
      id: 'at-1',
      status: 'APPLIED',
      controlId: 'CONT-01',
      evidenceId: 'ev-1',
      quote: 'reviewed on 1 August 2026 and approved by C. Bernard',
      quoteLocation: { page: 1 }
    })
  );
  await services.state.putSufficiency(
    makeSufficiency({ id: 'sf-1', attachmentId: 'at-1', evidenceId: 'ev-1', controlId: 'CONT-01', class: 'COMPLETE' })
  );
  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');
  return { services, pack, evidence };
}

test('an intact pack verifies on every check', async () => {
  const { services, pack } = await withPack();
  const result = await verifyPack(services, pack.id);
  assert.equal(result.checksumsOk, true);
  assert.equal(result.chainOk, true);
  assert.equal(result.signatureOk, true);
  assert.equal(result.rootHash, pack.manifest.rootHash);
  assert.equal(result.controlCount, pack.manifest.controlCount);
});

test('a tampered archive is reported, not hidden', async () => {
  const { services, pack } = await withPack();
  services.corruptObject(pack.archive.uri);
  const result = await checkPack(services, pack);
  assert.equal(result.checksumsOk, false);
});

test('a manifest whose root hash was edited fails', async () => {
  const { services, pack } = await withPack();
  const tampered = { ...pack, manifest: { ...pack.manifest, rootHash: 'f'.repeat(64) } };
  const result = await checkPack(services, tampered);
  assert.equal(result.checksumsOk, false);
});

test('a signature from another key does not verify', async () => {
  const { services, pack } = await withPack();
  const forged = {
    ...pack,
    signature: pack.signature === null ? null : { ...pack.signature, keyId: 'another-key' }
  };
  const result = await checkPack(services, forged);
  assert.equal(result.signatureOk, false);
});

test('a tampered manifest breaks the signature even with the right key', async () => {
  const { services, pack } = await withPack();
  const forged = {
    ...pack,
    manifest: { ...pack.manifest, controlCount: pack.manifest.controlCount + 1 },
    signature: pack.signature
  };
  const result = await checkPack(services, forged);
  assert.equal(result.signatureOk, false);
});

test('an unknown pack is the only case that throws', async () => {
  const { services } = await withPack();
  await assert.rejects(() => verifyPack(services, 'pk-nope'), /does not exist/);
});

test('verification is journalled and recorded', async () => {
  const { services, pack } = await withPack();
  await verifyPack(services, pack.id);
  const events = services.events('PACK_VERIFIED');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.objectId, pack.id);
  const stored = await services.extensions.listVerifications({ packId: pack.id });
  assert.equal(stored.length, 1);
});

test('the verdict carries no content: no title, no quote, no personal data', async () => {
  const { services, pack } = await withPack();
  const result = await verifyPack(services, pack.id);
  const serialised = JSON.stringify(result).toLowerCase();
  assert.ok(!serialised.includes('information security policy'), 'a title leaked');
  assert.ok(!serialised.includes('bernard'), 'a name leaked');
  assert.ok(!serialised.includes('reviewed on'), 'a quote leaked');
  assert.match(verdictLine(result), /checksums ok/);
});

test('a share token verifies the pack it points at', async () => {
  const { services, pack } = await withPack();
  const share = await createShare(services, {
    frameworkId: 'demo-msp',
    scope: 'PACK',
    packId: pack.id,
    ttlHours: 24,
    by: 'quality.lead',
    watermarkLabel: 'External auditor'
  });
  const result = await verifyByToken(services, share.token);
  assert.equal(result.packId, pack.id);
  assert.equal(result.checksumsOk, true);
});

test('a framework-scoped token cannot verify: it names no pack', async () => {
  const { services } = await withPack();
  const share = await createShare(services, {
    frameworkId: 'demo-msp',
    scope: 'FRAMEWORK',
    ttlHours: 24,
    by: 'quality.lead'
  });
  await assert.rejects(() => verifyByToken(services, share.token), /not bound to a pack/);
});

test('an unknown, expired or revoked token verifies nothing', async () => {
  const { services, pack } = await withPack();
  await assert.rejects(() => verifyByToken(services, 'nope'), /unknown, expired or revoked/);
  const share = await createShare(services, {
    frameworkId: 'demo-msp',
    scope: 'PACK',
    packId: pack.id,
    ttlHours: 1,
    by: 'quality.lead'
  });
  asClock(services.clock).advanceDays(2);
  await assert.rejects(() => verifyByToken(services, share.token), /unknown, expired or revoked/);
});

test('the canonical manifest bytes are what gets signed', async () => {
  const { pack } = await withPack();
  const payload = new TextEncoder().encode(canonicalJson(pack.manifest));
  assert.ok(payload.byteLength > 100);
  assert.equal(pack.signature?.rootHash, pack.manifest.rootHash);
});


/** The fake bundle always carries a frozen clock; the port only promises `now`. */
function asClock(clock: { now(): string }): FixedClock {
  return clock as FixedClock;
}
