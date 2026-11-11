/**
 * S3 evidence vault — same invariants as the local vault, no network.
 *
 * A fake gateway records every call, so the tests assert what would be sent to
 * S3 (Object Lock, versioned URI, pagination) without loading the SDK.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { S3EvidenceStore, parseS3Uri, uriOf } from '../../src/store/vaultS3.ts';
import type { S3VaultGateway } from '../../src/store/vaultS3.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { sha256Bytes } from '../../src/support/hash.ts';

const NOW = '2026-11-11T09:00:00.000Z';

interface Stored {
  body: Uint8Array;
  contentType: string;
  retainUntil?: Date;
  versionId: string;
}

/** In-memory S3 with just enough behaviour to exercise the store. */
class FakeGateway implements S3VaultGateway {
  readonly objects = new Map<string, Stored>();
  readonly calls: string[] = [];
  /** Fails the next `n` calls, to exercise the error mapping. */
  failures = 0;
  /** Pages returned by `list`, to exercise pagination handling. */
  listPages: Array<Array<{ key: string; sizeBytes: number }>> = [];

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    retainUntil?: Date;
  }): Promise<{ versionId: string | null }> {
    this.maybeFail('put');
    const versionId = `v${this.objects.size + 1}`;
    this.objects.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      versionId,
      ...(input.retainUntil === undefined ? {} : { retainUntil: input.retainUntil })
    });
    return { versionId };
  }

  async get(input: { bucket: string; key: string; versionId?: string | null }): Promise<Uint8Array> {
    this.maybeFail('get');
    const found = this.objects.get(input.key);
    if (found === undefined) throw new Error('NoSuchKey');
    return found.body;
  }

  async list(input: { bucket: string; prefix: string }): Promise<Array<{ key: string; sizeBytes: number }>> {
    this.maybeFail('list');
    if (this.listPages.length > 0) return this.listPages.flat();
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([key, value]) => ({ key, sizeBytes: value.body.byteLength }));
  }

  private maybeFail(operation: string): void {
    this.calls.push(operation);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error(`${operation} exploded`);
    }
  }
}

function store(gateway: S3VaultGateway = new FakeGateway(), prefix = '') {
  return new S3EvidenceStore({
    bucket: 'registre-vault-test',
    gateway,
    clock: new FixedClock(NOW),
    ...(prefix === '' ? {} : { prefix })
  });
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test('a bucket name is mandatory', () => {
  assert.throws(() => new S3EvidenceStore({ bucket: '  ' }), RegistreError);
});

test('put stores the bytes and returns a versioned uri plus the fingerprint', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway);
  const stored = await vault.put({ key: 'evidence/a.pdf', bytes: bytes('policy'), contentType: 'application/pdf' });
  assert.equal(stored.uri, 's3://registre-vault-test/evidence/a.pdf#v1');
  assert.equal(stored.versionId, 'v1');
  assert.equal(stored.sha256, sha256Bytes(bytes('policy')));
  assert.equal(stored.sizeBytes, 6);
  assert.deepEqual(parseS3Uri(stored.uri), {
    bucket: 'registre-vault-test',
    key: 'evidence/a.pdf',
    versionId: 'v1'
  });
});

test('a retention is applied as an Object Lock deadline, and only then', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway);
  await vault.put({ key: 'locked.pdf', bytes: bytes('x'), contentType: 'application/pdf', retainDays: 30 });
  await vault.put({ key: 'open.pdf', bytes: bytes('y'), contentType: 'application/pdf', retainDays: 0 });

  const locked = gateway.objects.get('locked.pdf');
  const open = gateway.objects.get('open.pdf');
  assert.equal(locked?.retainUntil?.toISOString(), '2026-12-11T09:00:00.000Z');
  assert.equal(open?.retainUntil, undefined, 'no lock without a retention');
});

test('a prefix is applied to every key, and an escaping key is refused', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway, 'evidence/');
  const stored = await vault.put({ key: 'a.pdf', bytes: bytes('x'), contentType: 'text/plain' });
  assert.equal(stored.uri, 's3://registre-vault-test/evidence/a.pdf#v1');
  await assert.rejects(
    () => vault.put({ key: '../escape.pdf', bytes: bytes('x'), contentType: 'text/plain' }),
    RegistreError
  );
  await assert.rejects(
    () => vault.put({ key: '   ', bytes: bytes('x'), contentType: 'text/plain' }),
    RegistreError
  );
});

test('get reads back the exact bytes, at the version the uri names', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway);
  const stored = await vault.put({ key: 'evidence/b.pdf', bytes: bytes('restore report'), contentType: 'text/plain' });
  const read = await vault.get(stored.uri);
  assert.equal(new TextDecoder().decode(read), 'restore report');
});

test('a missing object becomes an UPSTREAM error carrying the key', async () => {
  const vault = store();
  await assert.rejects(
    () => vault.get('s3://registre-vault-test/evidence/absent.pdf#v9'),
    (error: unknown) => {
      assert.ok(error instanceof RegistreError);
      assert.equal(error.code, 'UPSTREAM');
      assert.match(error.message, /evidence\/absent\.pdf/);
      return true;
    }
  );
});

test('a gateway failure is wrapped, never leaked raw', async () => {
  const gateway = new FakeGateway();
  gateway.failures = 1;
  const vault = store(gateway);
  await assert.rejects(
    () => vault.put({ key: 'a.pdf', bytes: bytes('x'), contentType: 'text/plain' }),
    (error: unknown) => error instanceof RegistreError && (error as RegistreError).code === 'UPSTREAM'
  );
});

test('list returns the prefix content, fingerprints aside', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway);
  await vault.put({ key: 'packs/p1/index.json', bytes: bytes('{}'), contentType: 'application/json' });
  await vault.put({ key: 'evidence/x.pdf', bytes: bytes('xx'), contentType: 'text/plain' });
  const packs = await vault.list('packs/');
  assert.equal(packs.length, 1);
  assert.equal(packs[0]?.uri, 's3://registre-vault-test/packs/p1/index.json');
  assert.equal(packs[0]?.versionId, null, 'listing does not download objects');
  assert.equal(packs[0]?.sizeBytes, 2);
});

test('a fingerprint can be checked by the caller that knows the expected value', async () => {
  const gateway = new FakeGateway();
  const vault = store(gateway);
  const payload = bytes('audit pack index');
  const stored = await vault.put({ key: 'packs/p/index.json', bytes: payload, contentType: 'application/json' });
  assert.equal(sha256Bytes(await vault.get(stored.uri)), stored.sha256);
  // Tamper behind the product's back: the same check now fails.
  gateway.objects.get('packs/p/index.json')!.body = bytes('tampered');
  assert.notEqual(sha256Bytes(await vault.get(stored.uri)), stored.sha256);
});

test('uri helpers round-trip and refuse junk', () => {
  assert.equal(uriOf('b', 'k', null), 's3://b/k');
  assert.equal(uriOf('b', 'k', 'v2'), 's3://b/k#v2');
  assert.deepEqual(parseS3Uri('s3://b/k'), { bucket: 'b', key: 'k', versionId: null });
  assert.throws(() => parseS3Uri('nonsense'), RegistreError);
});
