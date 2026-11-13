/**
 * Replaying an evidence the pipeline already stored — spec 11.3. No network:
 * the vault and the store are in-memory fakes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fromVaultObject } from '../../src/lambda/ingest.ts';

const services = {
  evidenceStore: { get: async () => new TextEncoder().encode('same bytes') },
  state: { findEvidenceByHash: async () => ({ id: 'ev-known' }) }
} as never;

const event = { bucket: 'vault', key: 'evidence/ev-known/v1.pdf' };

test('a stored evidence is a duplicate, unless the operator asks to reprocess it', async () => {
  const plain = await fromVaultObject(services, event);
  assert.equal(plain?.output.duplicate, true);
  const replay = await fromVaultObject(services, { ...event, reprocess: true });
  assert.equal(replay?.output.duplicate, false);
  assert.equal(replay?.output.evidenceId, 'ev-known');
});
