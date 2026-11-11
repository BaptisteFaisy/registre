/**
 * Collector registry and bounded collection run — EF-COL-05 (fingerprint,
 * duplicates, versions), R8 ("one single record, two noted locations") and
 * ENF-OBS-01 (supervision, alarm on failures).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectorRegistry, registryOf } from '../../src/collectors/registry.ts';
import { DEFAULT_COLLECTOR_TIMEOUT_MS, runCollectors } from '../../src/collectors/runCollectors.ts';
import { InMemoryAuditSink } from '../../src/store/auditMemory.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { RegistreError } from '../../src/support/errors.ts';
import type { CollectedFile, Collector, CollectorCursor } from '../../src/collectors/types.ts';
import { collectedFile } from '../../src/collectors/types.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

/** Builds a collected file from plain text. */
function fileOf(key: string, text: string, kind: CollectedFile['kind'] = 'S3'): CollectedFile {
  return collectedFile({
    key,
    uri: `${kind.toLowerCase()}://${key}`,
    kind,
    contentType: 'text/plain',
    bytes: new TextEncoder().encode(text),
    collectedAt: TEST_NOW
  });
}

/** Collector that returns a fixed list, or throws. */
function stubCollector(id: string, files: CollectedFile[], failure?: Error): Collector {
  return {
    id,
    kind: 'S3',
    async collect(_cursor?: CollectorCursor) {
      if (failure !== undefined) throw failure;
      return files;
    }
  };
}

test('registry: registers, lists and resolves collectors by id', () => {
  const registry = registryOf([stubCollector('b', []), stubCollector('a', [])]);

  assert.equal(registry.size, 2);
  assert.deepEqual(
    registry.list().map((collector) => collector.id),
    ['a', 'b']
  );
  assert.equal(registry.get('a')?.id, 'a');
  assert.equal(registry.get('zz'), null);
  assert.throws(() => registry.require('zz'), RegistreError);
});

test('registry: a duplicated id is a CONFLICT, upsert replaces it', () => {
  const registry = new CollectorRegistry().register(stubCollector('a', []));
  assert.throws(() => registry.register(stubCollector('a', [])), RegistreError);

  registry.upsert(stubCollector('a', [fileOf('k', 'x')]));
  assert.equal(registry.size, 1);
  assert.equal(registry.remove('a'), true);
  assert.equal(registry.remove('a'), false);
});

test('run: collects from every collector and counts the results (ENF-OBS-01)', async () => {
  const report = await runCollectors({
    collectors: [stubCollector('s3', [fileOf('a', 'one'), fileOf('b', 'two')])],
    clock
  });

  assert.equal(report.collected, 2);
  assert.equal(report.duplicates, 0);
  assert.equal(report.succeeded, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.runs[0]?.collected, 2);
  assert.equal(report.startedAt, TEST_NOW);
});

test('run: R8 — the same content collected twice is one record with two locations', async () => {
  const report = await runCollectors({
    collectors: [
      stubCollector('s3', [fileOf('s3/bucket/policy.txt', 'policy content')]),
      stubCollector('manual', [fileOf('manual/2026-11-11/policy-copy.txt', 'policy content', 'MANUAL')])
    ],
    clock
  });

  assert.equal(report.collected, 2, 'both files are reported');
  assert.equal(report.duplicates, 1, 'one of them is a duplicate');
  const duplicate = report.files.find((outcome) => outcome.duplicateOf !== null);
  assert.equal(duplicate?.duplicateOf, 's3/bucket/policy.txt');
  assert.equal(duplicate?.firstUri, 's3://s3/bucket/policy.txt');
  assert.equal(
    duplicate?.file.sha256,
    sha256Bytes(new TextEncoder().encode('policy content')),
    'the duplicate is detected on the fingerprint'
  );
});

test('run: R8 — content already in the store is reported as a duplicate', async () => {
  const stored = fileOf('s3/bucket/policy.txt', 'policy content');
  const report = await runCollectors({
    collectors: [stubCollector('manual', [fileOf('manual/policy.txt', 'policy content', 'MANUAL')])],
    clock,
    lookup: async (sha256) => (sha256 === stored.sha256 ? 'ev-known' : null)
  });

  assert.equal(report.duplicates, 1);
  assert.equal(report.files[0]?.duplicateOf, 'ev-known');
});

test('run: a failing collector does not stop the others, and is reported', async () => {
  const report = await runCollectors({
    collectors: [
      stubCollector('s3', [fileOf('a', 'one')]),
      stubCollector('itsm', [], new RegistreError('UPSTREAM', 'itsm unreachable')),
      stubCollector('manual', [fileOf('b', 'two', 'MANUAL')])
    ],
    clock
  });

  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.collected, 2);
  const failed = report.runs.find((run) => !run.ok);
  assert.equal(failed?.collectorId, 'itsm');
  assert.match(failed?.error ?? '', /itsm unreachable/);
});

test('run: every collected file and every failure is journalled (EF-ADM-02)', async () => {
  const audit = new InMemoryAuditSink({ clock });
  await runCollectors({
    collectors: [
      stubCollector('s3', [fileOf('a', 'one')]),
      stubCollector('itsm', [], new RegistreError('UPSTREAM', 'itsm unreachable'))
    ],
    clock,
    audit
  });

  const events = audit.entries();
  assert.equal(events.length, 2);
  assert.equal(events[0]?.action, 'EVIDENCE_COLLECTED');
  assert.equal(events[0]?.objectType, 'evidence');
  assert.equal(events[1]?.action, 'EVIDENCE_COLLECTED');
  assert.equal(events[1]?.objectType, 'collector');
  assert.equal(events[1]?.objectId, 'itsm');
  assert.equal(events[1]?.detail.status, 'FAILED');
  assert.deepEqual(await audit.verifyChain(), { ok: true, brokenAt: null });
});

test('run: a duplicate is journalled as EVIDENCE_DUPLICATE with both locations (R8)', async () => {
  const audit = new InMemoryAuditSink({ clock });
  await runCollectors({
    collectors: [
      stubCollector('s3', [fileOf('s3/policy.txt', 'same')]),
      stubCollector('manual', [fileOf('manual/policy.txt', 'same', 'MANUAL')])
    ],
    clock,
    audit
  });

  const events = audit.entries();
  assert.deepEqual(
    events.map((event) => event.action),
    ['EVIDENCE_COLLECTED', 'EVIDENCE_DUPLICATE']
  );
  assert.equal(events[1]?.detail.firstUri, 's3://s3/policy.txt');
  assert.equal(events[1]?.detail.uri, 'manual://manual/policy.txt');
});

test('run: onFile hands every produced file to the pipeline, in order', async () => {
  const seen: string[] = [];
  await runCollectors({
    collectors: [stubCollector('s3', [fileOf('a', 'one'), fileOf('b', 'two')])],
    clock,
    onFile: async (outcome) => {
      seen.push(outcome.file.key);
    }
  });

  assert.deepEqual(seen, ['a', 'b']);
});

test('run: a collector exceeding its budget is reported as failed', async () => {
  const slow: Collector = {
    id: 'slow',
    kind: 'ITSM',
    collect: () => new Promise<CollectedFile[]>(() => undefined)
  };
  const report = await runCollectors({ collectors: [slow], clock, timeoutMs: 10 });

  assert.equal(report.failed, 1);
  assert.match(report.runs[0]?.error ?? '', /budget/);
});

test('run: the default budget is bounded so one run stays inside the CI budget', () => {
  assert.equal(DEFAULT_COLLECTOR_TIMEOUT_MS, 30_000);
});

test('run: an empty registry produces an empty but valid report', async () => {
  const report = await runCollectors({ collectors: [], clock });
  assert.deepEqual(report.runs, []);
  assert.equal(report.collected, 0);
  assert.equal(report.succeeded, 0);
});
