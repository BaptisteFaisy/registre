/**
 * Validation routes — EF-VAL-01/02.
 *
 * Acceptance: the queue lists the pending items, and a decision keeps its
 * author, its date and its reason (motif), then returns the recomputed states.
 * The seed writes a real evidence, a real attachment and a pending item, so the
 * decision goes through the pipeline's own application logic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ValidationItem } from '../../src/domain/types.ts';
import type { Services } from '../../src/ports/index.ts';
import { makeAttachment, makeControl, makeEvidence, makeFramework, makeValidation } from '../fixtures/builders.ts';
import { makeStubPipeline } from './fakePipeline.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** Id of the seeded pending item. */
const PENDING_ID = 'va-pending-1';

/** Seeds a framework, a control, an evidence, a proposed attachment and its item. */
async function seedPending(services: Services, controlId = 'CONT-01'): Promise<ValidationItem> {
  await services.state.putFramework(makeFramework());
  await services.state.putControls([makeControl({ id: controlId })]);
  const evidence = makeEvidence({ id: 'ev-seed-1', accessLevel: 'INTERNAL' });
  await services.state.putEvidence(evidence);
  await services.state.putAttachment(
    makeAttachment({ id: 'at-seed-1', evidenceId: evidence.id, controlId, status: 'PROPOSED', autoApplied: false })
  );
  const item = makeValidation({
    id: PENDING_ID,
    kind: 'ATTACHMENT',
    attachmentId: 'at-seed-1',
    evidenceId: evidence.id,
    controlId,
    reason: 'confidence 0.62 below threshold 0.85',
    status: 'PENDING'
  });
  await services.state.putValidation(item);
  return item;
}

test('EF-VAL-01: GET /v1/validations?status=pending returns the queue', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const response = await api.request('GET', '/v1/validations?status=pending', { token: TOKENS.qualityLead });
    assert.equal(response.status, 200);
    const body = response.json as { status: string; total: number; items: ValidationItem[] };
    assert.equal(body.status, 'PENDING');
    assert.ok(body.total >= 1);
    assert.equal(body.items[0]?.status, 'PENDING');
  } finally {
    await api.close();
  }
});

test('EF-VAL-01: the queue defaults to pending and refuses an unknown status', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const defaulted = await api.request('GET', '/v1/validations', { token: TOKENS.qualityLead });
    assert.equal(defaulted.status, 200);
    assert.equal((defaulted.json as { status: string }).status, 'PENDING');
    const invalid = await api.request('GET', '/v1/validations?status=LATER', { token: TOKENS.qualityLead });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('EF-VAL-02: a decision keeps its author, its date and its note', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const response = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'ACCEPT', note: 'Correct control, quote matches page 2.' }
    });
    assert.equal(response.status, 200);
    const body = response.json as {
      item: { status: string; decision: string; decidedBy: string; decidedAt: string; note: string };
    };
    assert.equal(body.item.status, 'DECIDED');
    assert.equal(body.item.decision, 'ACCEPT');
    assert.equal(body.item.decidedBy, 'u-quality');
    assert.equal(body.item.note, 'Correct control, quote matches page 2.');
    assert.ok(body.item.decidedAt.length > 0);
    const stored = await services.state.getValidation(PENDING_ID);
    assert.equal(stored?.decision, 'ACCEPT');
    assert.equal(stored?.decidedBy, 'u-quality');
    const attachment = await services.state.getAttachment('at-seed-1');
    assert.equal(attachment?.status, 'APPLIED', 'an accepted attachment is applied');
  } finally {
    await api.close();
  }
});

test('EF-VAL-02: a rejection refuses the attachment with its reason', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const response = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'REJECT', note: 'The quote does not mention a restore test.' }
    });
    assert.equal(response.status, 200);
    const attachment = await services.state.getAttachment('at-seed-1');
    assert.equal(attachment?.status, 'REJECTED');
    assert.equal(attachment?.rejectionReason, 'HUMAN_REJECTED');
    assert.equal(attachment?.decidedNote, 'The quote does not mention a restore test.');
  } finally {
    await api.close();
  }
});

test('EF-VAL-02: a decision on an already decided item is 409', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const first = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'REJECT', note: 'Quote does not support the control.' }
    });
    assert.equal(first.status, 200);
    const second = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'ACCEPT' }
    });
    assert.equal(second.status, 409);
    assert.equal((second.json as { error: { code: string } }).error.code, 'CONFLICT');
  } finally {
    await api.close();
  }
});

test('EF-VAL-02: CORRECT without a target control is 400', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const response = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'CORRECT', note: 'Wrong control.' }
    });
    assert.equal(response.status, 400);
    assert.equal((response.json as { error: { detail: { field?: string } } }).error.detail.field, 'controlId');
  } finally {
    await api.close();
  }
});

test('EF-VAL-01: a decision on an unknown item is 404, an invalid decision is 400', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    const missing = await api.request('POST', '/v1/validations/va-nope/decision', {
      token: TOKENS.qualityLead,
      body: { decision: 'ACCEPT' }
    });
    assert.equal(missing.status, 404);
    const invalid = await api.request('POST', `/v1/validations/${PENDING_ID}/decision`, {
      token: TOKENS.qualityLead,
      body: { decision: 'MAYBE' }
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('EF-VAL-01: a control owner sees only the items about its own controls', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedPending(services);
    await services.state.putValidation(
      makeValidation({ id: 'va-pending-2', controlId: 'CONT-99', status: 'PENDING' })
    );
    const response = await api.request('GET', '/v1/validations', { token: TOKENS.controlOwner });
    assert.equal(response.status, 200);
    const body = response.json as { items: ValidationItem[] };
    assert.equal(body.items.length, 1, 'only the CONT-01 item belongs to this owner');
    assert.equal(body.items[0]?.controlId, 'CONT-01');
  } finally {
    await api.close();
  }
});

test('EF-VAL-01: after a real deposit the queue only holds known item kinds', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const response = await api.request('GET', '/v1/validations?status=pending', { token: TOKENS.qualityLead });
    assert.equal(response.status, 200);
    const body = response.json as { items: ValidationItem[] };
    for (const item of body.items) {
      assert.ok(['ATTACHMENT', 'SUFFICIENCY', 'UNREADABLE_EVIDENCE'].includes(item.kind));
    }
  } finally {
    await api.close();
  }
});
