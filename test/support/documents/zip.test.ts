/**
 * ZIP container — the base every OOXML format is built on. Properties checked:
 * the `PK` local-header magic, byte-exact round-trip (text and arbitrary
 * binary), multi-entry archives, and deterministic output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { zipEntries, unzipEntries } from '../../../src/support/documents/zip.ts';

const enc = new TextEncoder();

test('zipEntries emits the PK local-header magic', () => {
  const archive = zipEntries([{ name: 'a.txt', bytes: enc.encode('hello') }]);
  assert.equal(archive[0], 0x50); // 'P'
  assert.equal(archive[1], 0x4b); // 'K'
});

test('zip round-trips a single text entry byte for byte', () => {
  const bytes = enc.encode('the quick brown fox jumps over the lazy dog');
  const map = unzipEntries(zipEntries([{ name: 'note.txt', bytes }]));
  assert.deepEqual([...map.keys()], ['note.txt']);
  assert.deepEqual(map.get('note.txt'), bytes);
});

test('zip round-trips arbitrary binary bytes', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const map = unzipEntries(zipEntries([{ name: 'blob.dat', bytes }]));
  assert.deepEqual(map.get('blob.dat'), bytes);
});

test('zip preserves multiple entries and their order', () => {
  const entries = [
    { name: 'one.txt', bytes: enc.encode('first') },
    { name: 'two.txt', bytes: enc.encode('second') },
    { name: 'three.txt', bytes: enc.encode('third') }
  ];
  const map = unzipEntries(zipEntries(entries));
  assert.deepEqual([...map.keys()], ['one.txt', 'two.txt', 'three.txt']);
  for (const entry of entries) {
    assert.deepEqual(map.get(entry.name), entry.bytes);
  }
});

test('zip is deterministic: identical input yields identical bytes', () => {
  const entry = { name: 'det.txt', bytes: enc.encode('deterministic content') };
  assert.deepEqual(zipEntries([entry]), zipEntries([entry]));
});
