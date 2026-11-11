/**
 * Local vault — versions, retention lock and fingerprint verification
 * (ENF-INT-01, chapter 16.3). Every test uses its own temporary directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_VAULT_ROOT,
  LocalEvidenceStore,
  VAULT_ROOT_ENV,
  isRetained,
  normalizeKey,
  objectDirName,
  parseVaultUri,
  vaultRootFromEnv
} from '../../src/store/vault.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);
const POLICY = new TextEncoder().encode('Information security policy, version 3.1.');

/** Runs `body` with a store rooted in a fresh temporary directory. */
async function withVault(
  body: (store: LocalEvidenceStore, root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'registre-vault-'));
  try {
    await body(new LocalEvidenceStore({ root, clock }), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Asserts that `work` rejects with a `RegistreError` of the given code. */
async function rejectsWith(work: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof RegistreError, 'a RegistreError is expected');
    assert.equal(error.code, code);
    return true;
  });
}

test('put: stores bytes and returns the fingerprint, size and version (ENF-INT-01)', async () => {
  await withVault(async (store) => {
    const stored = await store.put({
      key: 'manual/2026-11-11/policy.txt',
      bytes: POLICY,
      contentType: 'text/plain'
    });

    assert.equal(stored.sha256, sha256Bytes(POLICY));
    assert.equal(stored.sizeBytes, POLICY.byteLength);
    assert.equal(stored.versionId, 'v1');
    assert.equal(stored.uri, 'vault://manual/2026-11-11/policy.txt#v1');
  });
});

test('get: returns the exact bytes that were stored', async () => {
  await withVault(async (store) => {
    const stored = await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    const read = await store.get(stored.uri);
    assert.deepEqual(Array.from(read), Array.from(POLICY));
  });
});

test('get: the URI without a fragment resolves to the latest version', async () => {
  await withVault(async (store) => {
    await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    await store.put({ key: 'a/policy.txt', bytes: new TextEncoder().encode('v2'), contentType: 'text/plain' });

    const latest = await store.get('vault://a/policy.txt');
    assert.equal(new TextDecoder().decode(latest), 'v2');
  });
});

test('put: a rewrite creates a new version and never overwrites the previous one (EF-COL-05)', async () => {
  await withVault(async (store) => {
    const first = await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    const second = await store.put({
      key: 'a/policy.txt',
      bytes: new TextEncoder().encode('version 4.0'),
      contentType: 'text/plain'
    });

    assert.equal(first.versionId, 'v1');
    assert.equal(second.versionId, 'v2');
    const versions = await store.versions('a/policy.txt');
    assert.deepEqual(
      versions.map((version) => version.versionId),
      ['v1', 'v2']
    );
    assert.deepEqual(Array.from(await store.get(first.uri)), Array.from(POLICY));
    assert.equal(new TextDecoder().decode(await store.get(second.uri)), 'version 4.0');
  });
});

test('retention: an object under legal hold refuses modification (ENF-INT-01)', async () => {
  await withVault(async (store) => {
    const stored = await store.put({
      key: 'a/retained.txt',
      bytes: POLICY,
      contentType: 'text/plain',
      retainDays: 30
    });
    assert.ok(stored.uri.length > 0);

    await rejectsWith(
      store.put({ key: 'a/retained.txt', bytes: new TextEncoder().encode('tampered'), contentType: 'text/plain' }),
      'CONFLICT'
    );
  });
});

test('retention: an object under legal hold refuses deletion', async () => {
  await withVault(async (store) => {
    const stored = await store.put({
      key: 'a/retained.txt',
      bytes: POLICY,
      contentType: 'text/plain',
      retainDays: 30
    });
    await rejectsWith(store.delete(stored.uri), 'CONFLICT');
    assert.deepEqual(Array.from(await store.get(stored.uri)), Array.from(POLICY));
  });
});

test('retention: once the period has elapsed, the object can be modified again', async () => {
  await withVault(async (store) => {
    await store.put({ key: 'a/short.txt', bytes: POLICY, contentType: 'text/plain', retainDays: 1 });
    clock.advanceDays(2);
    try {
      const next = await store.put({
        key: 'a/short.txt',
        bytes: new TextEncoder().encode('renewed'),
        contentType: 'text/plain'
      });
      assert.equal(next.versionId, 'v2');
    } finally {
      clock.advanceDays(-2);
    }
  });
});

test('retention: an object without retainDays can be rewritten and deleted', async () => {
  await withVault(async (store) => {
    const stored = await store.put({ key: 'a/free.txt', bytes: POLICY, contentType: 'text/plain' });
    await store.put({ key: 'a/free.txt', bytes: new TextEncoder().encode('v2'), contentType: 'text/plain' });
    await store.delete(stored.uri);
    assert.deepEqual(
      (await store.versions('a/free.txt')).map((version) => version.versionId),
      ['v2']
    );
  });
});

test('integrity: a blob altered on disk is refused on read (chapter 16.3)', async () => {
  await withVault(async (store, root) => {
    const stored = await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    const directory = join(root, 'objects', objectDirName('a/policy.txt'));
    const blobs = (await readdir(directory)).filter((name) => name.endsWith('.bin'));
    assert.equal(blobs.length, 1);
    await writeFile(join(directory, blobs[0]!), new TextEncoder().encode('substituted content'));

    await rejectsWith(store.get(stored.uri), 'UNREADABLE');
  });
});

test('integrity: the fingerprint recorded in the manifest matches the bytes', async () => {
  await withVault(async (store) => {
    const stored = await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    const [version] = await store.versions('a/policy.txt');
    assert.equal(version?.sha256, stored.sha256);
    assert.equal(sha256Bytes(await store.get(stored.uri)), stored.sha256);
  });
});

test('get: an unknown key or an unknown version is NOT_FOUND', async () => {
  await withVault(async (store) => {
    await rejectsWith(store.get('vault://a/missing.txt'), 'NOT_FOUND');
    await store.put({ key: 'a/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    await rejectsWith(store.get('vault://a/policy.txt#v9'), 'NOT_FOUND');
  });
});

test('list: returns the latest version of every object under the prefix', async () => {
  await withVault(async (store) => {
    await store.put({ key: 's3/bucket/policy.txt', bytes: POLICY, contentType: 'text/plain' });
    await store.put({ key: 's3/bucket/policy.txt', bytes: new TextEncoder().encode('v2'), contentType: 'text/plain' });
    await store.put({ key: 's3/bucket/report.csv', bytes: new TextEncoder().encode('a,b'), contentType: 'text/csv' });
    await store.put({ key: 'manual/policy.txt', bytes: POLICY, contentType: 'text/plain' });

    const scoped = await store.list('s3/bucket/');
    assert.deepEqual(
      scoped.map((object) => object.uri).sort(),
      ['vault://s3/bucket/policy.txt#v2', 'vault://s3/bucket/report.csv#v1']
    );
    assert.equal((await store.list('')).length, 3);
    assert.deepEqual(await store.list('nothing/'), []);
  });
});

test('keys: a key with ".." or "#" is rejected', () => {
  assert.equal(normalizeKey('/a/policy.txt'), 'a/policy.txt');
  assert.throws(() => normalizeKey('a/../../etc/passwd'), RegistreError);
  assert.throws(() => normalizeKey('a/policy#v1.txt'), RegistreError);
  assert.throws(() => normalizeKey('   '), RegistreError);
});

test('keys: the directory name is readable and collision-free', () => {
  assert.match(objectDirName('a/policy.txt'), /^a_policy\.txt-[0-9a-f]{8}$/);
  assert.notEqual(objectDirName('a/b.txt'), objectDirName('a_b.txt'));
});

test('URIs: parsing keeps the key and the version apart', () => {
  assert.deepEqual(parseVaultUri('vault://a/policy.txt#v2'), { key: 'a/policy.txt', versionId: 'v2' });
  assert.deepEqual(parseVaultUri('vault://a/policy.txt'), { key: 'a/policy.txt', versionId: null });
  assert.throws(() => parseVaultUri('s3://bucket/key'), RegistreError);
});

test('retention: isRetained is true only before the end of the hold', () => {
  const version = {
    versionId: 'v1',
    uri: 'vault://a#v1',
    sha256: 'a'.repeat(64),
    sizeBytes: 1,
    contentType: 'text/plain',
    storedAt: TEST_NOW,
    retainDays: 30,
    retainUntil: '2026-12-11T12:00:00.000Z'
  };
  assert.equal(isRetained(version, '2026-11-11T12:00:00.000Z'), true);
  assert.equal(isRetained(version, '2026-12-12T12:00:00.000Z'), false);
  assert.equal(isRetained({ ...version, retainUntil: null }, TEST_NOW), false);
});

test('configuration: the vault root comes from the environment, with a default', () => {
  assert.equal(vaultRootFromEnv({}), DEFAULT_VAULT_ROOT);
  assert.equal(vaultRootFromEnv({ [VAULT_ROOT_ENV]: '/tmp/vault-test' }), '/tmp/vault-test');
});
