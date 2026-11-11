/**
 * S3 collector — EF-COL-01 (collect a bucket prefix) and EF-COL-05
 * (fingerprint every file). The lister is injected: no network, no AWS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Collector, s3ObjectKey } from '../../src/collectors/s3.ts';
import type { S3Lister, S3ListInput, S3Page } from '../../src/collectors/s3.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

/** In-memory lister: objects keyed by name, with a recorded call log. */
function fakeLister(objects: Record<string, string>, modified = '2026-11-01T08:00:00.000Z') {
  const calls: S3ListInput[] = [];
  const lister: S3Lister = {
    async list(input): Promise<S3Page> {
      calls.push(input);
      return {
        objects: Object.keys(objects).map((key) => ({
          key,
          sizeBytes: new TextEncoder().encode(objects[key]!).byteLength,
          lastModified: modified
        }))
      };
    },
    async get(input) {
      const body = objects[input.key];
      if (body === undefined) throw new Error(`unexpected key ${input.key}`);
      return { bytes: new TextEncoder().encode(body), contentType: 'text/plain' };
    }
  };
  return { lister, calls };
}

function collector(lister: S3Lister, overrides: { maxObjects?: number } = {}): S3Collector {
  return new S3Collector({
    bucket: 'msp-evidence',
    prefix: 'documents/',
    clock,
    lister,
    ...overrides
  });
}

test('collect: lists the prefix and downloads every object (EF-COL-01)', async () => {
  const { lister, calls } = fakeLister({
    'documents/policy.txt': 'policy',
    'documents/report.txt': 'report'
  });
  const files = await collector(lister).collect();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.bucket, 'msp-evidence');
  assert.equal(calls[0]?.prefix, 'documents/');
  assert.deepEqual(
    files.map((file) => file.title),
    ['policy.txt', 'report.txt']
  );
});

test('collect: every file carries its fingerprint and its provenance (EF-COL-05)', async () => {
  const { lister } = fakeLister({ 'documents/policy.txt': 'policy' });
  const [file] = await collector(lister).collect();

  assert.ok(file !== undefined);
  assert.equal(file.sha256, sha256Bytes(new TextEncoder().encode('policy')));
  assert.equal(file.sizeBytes, 6);
  assert.equal(file.uri, 's3://msp-evidence/documents/policy.txt');
  assert.equal(file.key, 's3/msp-evidence/documents/policy.txt');
  assert.equal(file.kind, 'S3');
  assert.equal(file.collectedAt, TEST_NOW);
  assert.equal(file.metadata?.bucket, 'msp-evidence');
});

test('collect: the run is bounded by maxObjects (EF-PERF-01)', async () => {
  const { lister } = fakeLister({
    'documents/a.txt': 'a',
    'documents/b.txt': 'b',
    'documents/c.txt': 'c'
  });
  const files = await collector(lister, { maxObjects: 2 }).collect();
  assert.equal(files.length, 2);
});

test('collect: the cursor period filters objects on their last modification', async () => {
  const recent = fakeLister({ 'documents/policy.txt': 'policy' }, '2026-11-05T08:00:00.000Z');
  const old = fakeLister({ 'documents/policy.txt': 'policy' }, '2026-09-01T08:00:00.000Z');

  assert.equal(
    (await collector(recent.lister).collect({ since: '2026-11-01T00:00:00.000Z' })).length,
    1
  );
  assert.equal(
    (await collector(old.lister).collect({ since: '2026-11-01T00:00:00.000Z' })).length,
    0
  );
});

test('collect: a pagination token is passed through to the lister', async () => {
  const { lister, calls } = fakeLister({ 'documents/policy.txt': 'policy' });
  await collector(lister).collect({ token: 'page-2' });
  assert.equal(calls[0]?.continuationToken, 'page-2');
});

test('collect: a source without last-modified dates is not filtered out', async () => {
  const lister: S3Lister = {
    async list() {
      return { objects: [{ key: 'documents/policy.txt', sizeBytes: 6, lastModified: null }] };
    },
    async get() {
      return { bytes: new TextEncoder().encode('policy'), contentType: 'text/plain' };
    }
  };
  const [file] = await collector(lister).collect({ since: '2026-11-01T00:00:00.000Z' });
  assert.ok(file !== undefined);
  assert.equal(file.fileDate, null);
});

test('collect: the content type comes from S3, or is guessed from the name', async () => {
  const lister: S3Lister = {
    async list() {
      return { objects: [{ key: 'documents/report.csv', sizeBytes: 3, lastModified: null }] };
    },
    async get() {
      return { bytes: new TextEncoder().encode('a,b'), contentType: '' };
    }
  };
  const [file] = await collector(lister).collect();
  assert.equal(file?.contentType, 'text/csv');
});

test('keys: the vault key keeps the prefix readable and sanitised', () => {
  assert.equal(s3ObjectKey('msp-evidence', 'documents/policy.pdf'), 's3/msp-evidence/documents/policy.pdf');
  assert.equal(s3ObjectKey('bucket', 'a b/c d.pdf'), 's3/bucket/a-b/c-d.pdf');
  assert.equal(s3ObjectKey('bucket', 'documents//x.pdf'), 's3/bucket/documents/x.pdf');
});
