/**
 * Audit log — valid chain, tamper detection, monotonic order (ENF-INT-02).
 * Also covers the hash chain helpers shared with the DynamoDB sink.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../../src/store/auditMemory.ts';
import { GENESIS_HASH, eventDigest, sealEvent, verifyEvents } from '../../src/store/auditChain.ts';
import type { AuditEvent } from '../../src/domain/types.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

async function threeEvents(): Promise<InMemoryAuditSink> {
  const sink = new InMemoryAuditSink({ clock });
  await sink.append({ actor: 'quality.lead', action: 'FRAMEWORK_IMPORTED', objectType: 'framework', objectId: 'demo-msp' });
  await sink.append({
    actor: 'collector-s3',
    action: 'EVIDENCE_COLLECTED',
    objectType: 'evidence',
    objectId: 'ev-1',
    detail: { sha256: 'a'.repeat(64) }
  });
  await sink.append({ actor: 'quality.lead', action: 'ATTACHMENT_APPLIED', objectType: 'attachment', objectId: 'at-1' });
  return sink;
}

test('append: first event chains onto genesis, next ones onto the previous hash', async () => {
  const sink = await threeEvents();
  const events = sink.entries();

  assert.equal(events.length, 3);
  assert.equal(events[0]?.prevHash, GENESIS_HASH);
  assert.equal(events[1]?.prevHash, events[0]?.hash);
  assert.equal(events[2]?.prevHash, events[1]?.hash);
  assert.equal(new Set(events.map((event) => event.id)).size, 3, 'every event has its own id');
});

test('append: sequence numbers are monotonic from 1', async () => {
  const sink = await threeEvents();
  assert.deepEqual(
    sink.entries().map((event) => event.seq),
    [1, 2, 3]
  );
});

test('append: an event is sealed over its whole content', async () => {
  const sink = await threeEvents();
  for (const event of sink.entries()) {
    const { hash, ...unsigned } = event;
    assert.equal(eventDigest(unsigned), hash);
  }
});

test('verifyChain: an untouched log is intact', async () => {
  const sink = await threeEvents();
  assert.deepEqual(await sink.verifyChain(), { ok: true, brokenAt: null });
});

test('verifyChain: an empty log is intact', async () => {
  const sink = new InMemoryAuditSink({ clock });
  assert.deepEqual(await sink.verifyChain(), { ok: true, brokenAt: null });
});

test('verifyChain: altering the detail of one event is detected at its sequence', async () => {
  const sink = await threeEvents();
  const events = sink.entries() as AuditEvent[];
  events[1] = { ...events[1]!, detail: { sha256: 'f'.repeat(64) } };

  assert.deepEqual(await sink.verifyChain(), { ok: false, brokenAt: 2 });
});

test('verifyChain: altering the hash of one event is detected', async () => {
  const sink = await threeEvents();
  const events = sink.entries() as AuditEvent[];
  events[0] = { ...events[0]!, hash: 'deadbeef' };

  const verdict = await sink.verifyChain();
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 1);
});

test('verifyChain: removing an event breaks the chain at the next sequence', async () => {
  const sink = await threeEvents();
  const events = sink.entries() as AuditEvent[];
  events.splice(1, 1);

  assert.deepEqual(await sink.verifyChain(), { ok: false, brokenAt: 3 });
});

test('verifyChain: reordering two events is detected', async () => {
  const sink = await threeEvents();
  const events = sink.entries() as AuditEvent[];
  const swapped = [events[0]!, events[2]!, events[1]!];

  assert.equal(verifyEvents(swapped).ok, false);
});

test('verifyChain: a forged event with a recomputed hash still breaks the previous link', async () => {
  const sink = await threeEvents();
  const events = sink.entries() as AuditEvent[];
  const forged = sealEvent(
    {
      seq: 2,
      at: TEST_NOW,
      actor: 'intruder',
      action: 'EVIDENCE_COLLECTED',
      objectType: 'evidence',
      objectId: 'ev-forged'
    },
    events[0]!.hash
  );
  events[1] = forged;

  assert.deepEqual(await sink.verifyChain(), { ok: false, brokenAt: 3 });
});

test('list: most recent first, with action and object filters', async () => {
  const sink = await threeEvents();

  assert.deepEqual(
    (await sink.list()).map((event) => event.seq),
    [3, 2, 1]
  );
  assert.deepEqual(
    (await sink.list({ action: 'EVIDENCE_COLLECTED' })).map((event) => event.objectId),
    ['ev-1']
  );
  assert.deepEqual(
    (await sink.list({ objectId: 'at-1' })).map((event) => event.action),
    ['ATTACHMENT_APPLIED']
  );
  assert.deepEqual(
    (await sink.list({ limit: 2 })).map((event) => event.seq),
    [3, 2]
  );
});

test('list: a returned event is a copy, so a caller cannot rewrite the log', async () => {
  const sink = await threeEvents();
  const listed = await sink.list({ limit: 1 });
  listed[0]!.actor = 'intruder';

  const reread = await sink.list({ limit: 1 });
  assert.equal(reread[0]?.actor, 'quality.lead');
  assert.deepEqual(await sink.verifyChain(), { ok: true, brokenAt: null });
});

test('the digest is stable whatever the key order of the detail object', () => {
  const base: Omit<AuditEvent, 'hash'> = {
    seq: 1,
    id: 'ae-fixed',
    at: TEST_NOW,
    actor: 'quality.lead',
    action: 'SETTINGS_UPDATED',
    objectType: 'settings',
    objectId: 'settings',
    detail: {},
    prevHash: GENESIS_HASH
  };
  const left: Omit<AuditEvent, 'hash'> = { ...base, detail: { b: 2, a: 1 } };
  const right: Omit<AuditEvent, 'hash'> = { ...base, detail: { a: 1, b: 2 } };

  assert.equal(eventDigest(left), eventDigest(right));
  assert.notEqual(eventDigest({ ...base, detail: { a: 2 } }), eventDigest(left));
});
