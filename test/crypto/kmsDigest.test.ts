/**
 * The KMS signer signs the manifest's SHA-256 (MessageType DIGEST), which KMS
 * accepts at any manifest size — ENF-SEC (signed audit pack). No network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestOf } from '../../src/crypto/kmsSigner.ts';

test('the signed message is the 32-byte SHA-256 of the manifest, whatever its size', () => {
  const manifest = new TextEncoder().encode('x'.repeat(50_000));
  const digest = digestOf(manifest);
  assert.equal(digest.byteLength, 32);
  assert.equal(Buffer.from(digest).toString('hex'), createHash('sha256').update(manifest).digest('hex'));
});
