import test from 'node:test';
import assert from 'node:assert/strict';

import { base64ToBytes, bytesToBase64, utf8ToBytes } from './base64.ts';

test('an empty document encodes as an empty string', () => {
  assert.equal(bytesToBase64(new Uint8Array(0)), '');
  assert.equal(base64ToBytes('').length, 0);
  assert.deepEqual(base64ToBytes(''), new Uint8Array(0));
});

test('text is encoded from its UTF-8 bytes', () => {
  assert.equal(bytesToBase64(utf8ToBytes('Hello')), 'SGVsbG8=');
  assert.equal(bytesToBase64(utf8ToBytes('a')), 'YQ==');
  assert.equal(bytesToBase64(utf8ToBytes('ab')), 'YWI=');
  assert.equal(bytesToBase64(utf8ToBytes('abc')), 'YWJj');
  const accent = utf8ToBytes('Registre — audit');
  assert.deepEqual(base64ToBytes(bytesToBase64(accent)), accent);
});

test('bytes that are not UTF-8 survive the round trip', () => {
  const binary = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xfe, 0x01, 0x25, 0x50, 0x44, 0x46]);
  const encoded = bytesToBase64(binary);
  assert.equal(encoded.length % 4, 0);
  assert.deepEqual(base64ToBytes(encoded), binary);
});

test('the encoding is idempotent', () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 0, 99, 255]);
  const once = bytesToBase64(bytes);
  assert.equal(bytesToBase64(base64ToBytes(once)), once);
  assert.deepEqual(base64ToBytes(bytesToBase64(base64ToBytes(once))), bytes);
});

test('padding is optional when decoding', () => {
  const bytes = utf8ToBytes('audit pack');
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes).replace(/=+$/, '')), bytes);
});

test('a character outside the alphabet is refused', () => {
  assert.throws(() => base64ToBytes('SGVs*bG8='), /base64/);
});
