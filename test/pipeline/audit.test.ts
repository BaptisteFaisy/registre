/**
 * Audit helpers — EF-ADM-02 ("journal de toutes les actions") and ENF-INT-02
 * (append-only, hash-chained). The chain lives in the adapter; these helpers
 * only shape the call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAccessDenied, record } from '../../src/audit/log.ts';
import type { AccessDecision } from '../../src/domain/access.ts';
import { fakeServices, principal } from './fakeServices.ts';

test('record appends one typed event with its detail', async () => {
  const services = fakeServices();
  const event = await record(services, 'quality.lead', 'PACK_DOWNLOADED', 'pack', 'pk-1', { sizeBytes: 42 });

  assert.equal(event.actor, 'quality.lead');
  assert.equal(event.action, 'PACK_DOWNLOADED');
  assert.equal(event.objectType, 'pack');
  assert.equal(event.objectId, 'pk-1');
  assert.equal(event.detail.sizeBytes, 42);
  assert.equal(services.events().length, 1);
});

test('record defaults to an empty detail rather than undefined', async () => {
  const services = fakeServices();
  const event = await record(services, 'pipeline', 'STATE_RECOMPUTED', 'framework', 'demo-msp');
  assert.deepEqual(event.detail, {});
});

test('a refusal is journalled with the reason codes of the domain', async () => {
  const services = fakeServices();
  const decision: AccessDecision = { allowed: false, reason: 'ROLE_NOT_ALLOWED' };
  const event = await auditAccessDenied(
    services,
    principal({ id: 'u-exec', role: 'EXECUTIVE', clearance: 'INTERNAL' }),
    decision,
    'evidence',
    'ev-hr'
  );

  assert.equal(event.action, 'ACCESS_DENIED');
  assert.equal(event.actor, 'u-exec');
  assert.equal(event.objectId, 'ev-hr');
  assert.equal(event.detail.reason, 'ROLE_NOT_ALLOWED');
  assert.equal(event.detail.role, 'EXECUTIVE');
});

test('the events accumulate in order, as an append-only log does', async () => {
  const services = fakeServices();
  await record(services, 'a', 'EVIDENCE_COLLECTED', 'evidence', 'ev-1');
  await record(services, 'a', 'EVIDENCE_READ', 'evidence', 'ev-1');

  const actions = services.events().map((event) => event.action);
  assert.deepEqual(actions, ['EVIDENCE_COLLECTED', 'EVIDENCE_READ']);
  assert.equal((await services.audit.verifyChain()).ok, true);
});
