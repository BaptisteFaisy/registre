/**
 * Manual deposit collector — EF-COL-02: a portal deposit with bytes and
 * metadata, target control optional.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualCollector } from '../../src/collectors/manual.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { TEST_NOW, TEST_TODAY } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);
const bytes = new TextEncoder().encode('Restore test report, 14 October 2026.');

test('deposit: queues one file with its fingerprint and provenance (EF-COL-02)', async () => {
  const collector = new ManualCollector(clock);
  const file = collector.deposit({
    filename: 'restore-test.pdf',
    bytes,
    submittedBy: 'ops.owner',
    title: 'Restore test October',
    fileDate: '2026-10-14'
  });

  assert.equal(file.sha256, sha256Bytes(bytes));
  assert.equal(file.sizeBytes, bytes.byteLength);
  assert.equal(file.kind, 'MANUAL');
  assert.equal(file.key, `manual/${TEST_TODAY}/restore-test.pdf`);
  assert.equal(file.uri, 'manual://ops.owner/restore-test.pdf');
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.fileDate, '2026-10-14');
  assert.equal(file.metadata?.submittedBy, 'ops.owner');
  assert.equal(file.metadata?.originalName, 'restore-test.pdf');
});

test('deposit: the target control is optional and kept when provided (EF-COL-02)', async () => {
  const collector = new ManualCollector(clock);
  const targeted = collector.deposit({
    filename: 'test.txt',
    bytes,
    submittedBy: 'ops.owner',
    controlId: 'CONT-03'
  });
  const loose = collector.deposit({ filename: 'other.txt', bytes, submittedBy: 'ops.owner' });

  assert.equal(targeted.controlId, 'CONT-03');
  assert.equal(loose.controlId, undefined);
});

test('deposit: the content type is guessed when the portal does not declare it', async () => {
  const collector = new ManualCollector(clock);
  const csv = collector.deposit({ filename: 'tickets.csv', bytes, submittedBy: 'ops.owner' });
  const explicit = collector.deposit({
    filename: 'tickets.csv',
    bytes,
    submittedBy: 'ops.owner',
    contentType: 'text/plain'
  });
  assert.equal(csv.contentType, 'text/csv');
  assert.equal(explicit.contentType, 'text/plain');
});

test('deposit: a note is journalled with the evidence', () => {
  const collector = new ManualCollector(clock);
  const file = collector.deposit({
    filename: 'test.txt',
    bytes,
    submittedBy: 'ops.owner',
    note: 'Found in the shared drive'
  });
  assert.equal(file.metadata?.note, 'Found in the shared drive');
});

test('deposit: an empty file name or a missing depositor is a BAD_REQUEST', () => {
  const collector = new ManualCollector(clock);
  assert.throws(() => collector.deposit({ filename: '  ', bytes, submittedBy: 'ops.owner' }), RegistreError);
  assert.throws(() => collector.deposit({ filename: 'test.txt', bytes, submittedBy: '' }), RegistreError);
});

test('deposit: an empty payload is refused', () => {
  const collector = new ManualCollector(clock);
  assert.throws(
    () => collector.deposit({ filename: 'empty.txt', bytes: new Uint8Array(), submittedBy: 'ops.owner' }),
    RegistreError
  );
});

test('collect: drains the queue once, so a deposit is ingested exactly once', async () => {
  const collector = new ManualCollector(clock);
  collector.deposit({ filename: 'a.txt', bytes, submittedBy: 'ops.owner' });
  collector.deposit({ filename: 'b.txt', bytes, submittedBy: 'ops.owner' });
  assert.equal(collector.queued, 2);

  const first = await collector.collect();
  const second = await collector.collect();

  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(collector.queued, 0);
});

test('deposit: the vault key keeps the day of the deposit', () => {
  const collector = new ManualCollector(new FixedClock('2026-12-01T09:30:00.000Z'));
  const file = collector.deposit({ filename: 'policy.pdf', bytes, submittedBy: 'ops.owner' });
  assert.equal(file.key, 'manual/2026-12-01/policy.pdf');
});
