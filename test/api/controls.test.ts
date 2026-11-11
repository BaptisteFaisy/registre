/**
 * Control routes — EF-FRA-02, EF-RAT-02, EF-REL-01/02.
 *
 * `GET /v1/controls/{id}` answers the control with its relations in one call:
 * its current state, its attachments in the domain shape (quotes and sufficiency
 * included), the sufficiencies and the evidence. The evidence route lists the
 * bare evidence attached to the control, and `remind` answers the bare reminder
 * it just sent — or 409 when no reminder is due.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAttachment, makeControl, makeEvidence, makeFramework, makeSufficiency } from '../fixtures/builders.ts';
import { makeStubPipeline } from './fakePipeline.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, frameworkPayload, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** One attachment of the control detail, in its domain shape. */
interface DomainAttachment {
  id: string;
  evidenceId: string;
  quote: string;
  quoteLocation: { page: number | null };
  status: string;
  attachmentId?: unknown;
}

/** The control detail payload of `GET /v1/controls/{id}`. */
interface ControlWithRelations {
  control: { id: string; periodicity: string; expectedEvidence: string[] };
  status: { controlId: string; state: string; computedAt: string } | null;
  attachments: DomainAttachment[];
  sufficiencies: Array<{ id: string; attachmentId: string; class: string; missing: string[] }>;
  evidence: Array<{ id: string; sha256: string }>;
}

/** Seeds one sufficiency on the attachment the deposit created. */
async function seedSufficiency(
  services: ReturnType<typeof makeTestServices>,
  controlId = 'CONT-01'
): Promise<void> {
  const attachments = await services.state.listAttachments({ controlId });
  const attachment = attachments[0];
  if (attachment === undefined) throw new Error(`no attachment on ${controlId} to make a sufficiency of`);
  await services.state.putSufficiency(
    makeSufficiency({
      attachmentId: attachment.id,
      evidenceId: attachment.evidenceId,
      controlId,
      class: 'PARTIAL',
      missing: ['Approver name']
    })
  );
}

test('EF-FRA-02: GET /v1/controls/{id} returns the control and its state', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/controls/CONT-01', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as ControlWithRelations;
    assert.equal(body.control.id, 'CONT-01');
    assert.equal(body.control.periodicity, 'P1Y');
    assert.equal(body.status?.controlId, 'CONT-01');
    assert.equal(body.status?.state, 'NO_EVIDENCE');
    assert.ok((body.status?.computedAt ?? '').length > 0);
  } finally {
    await api.close();
  }
});

test('GET /v1/controls/{id} answers the five keys of the control detail', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    await seedSufficiency(services);
    const response = await api.request('GET', '/v1/controls/CONT-01', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['attachments', 'control', 'evidence', 'status', 'sufficiencies']);
  } finally {
    await api.close();
  }
});

test('EF-RAT-02: the control detail carries the quote and the sufficiency of its evidence', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    await seedSufficiency(services);
    const response = await api.request('GET', '/v1/controls/CONT-01', { token: TOKENS.auditor });
    const body = response.json as ControlWithRelations;
    assert.ok(body.attachments.length >= 1);
    const attachment = body.attachments[0]!;
    assert.match(attachment.id, /^at-/, 'the attachment carries its own id in the domain shape');
    assert.equal(attachment.attachmentId, undefined, 'no wrapper id is left in the domain shape');
    assert.ok(attachment.quote.length > 0, 'a proposal always carries its quote (EF-RAT-02)');
    assert.ok(['PROPOSED', 'APPLIED', 'REJECTED'].includes(attachment.status));
    assert.ok(attachment.quoteLocation !== undefined);
    assert.equal(body.sufficiencies.length, 1);
    assert.equal(body.sufficiencies[0]?.attachmentId, attachment.id);
    assert.equal(body.sufficiencies[0]?.class, 'PARTIAL');
    assert.deepEqual(body.sufficiencies[0]?.missing, ['Approver name']);
    assert.ok(body.evidence.length >= 1);
  } finally {
    await api.close();
  }
});

test('EF-RAT-02: the evidence of a control is listed as bare evidence', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const deposit = await depositPolicy(api);
    const response = await api.request('GET', '/v1/controls/CONT-01/evidence', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const rows = response.json as Array<{ id: string; sha256: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, (deposit.json as { id: string }).id);
    assert.equal(rows[0]?.sha256.length, 64);
  } finally {
    await api.close();
  }
});

test('GET /v1/controls/{id} is 404 for an unknown control', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/controls/CONT-99', { token: TOKENS.auditor });
    assert.equal(response.status, 404);
    assert.equal((response.json as { error: { code: string } }).error.code, 'NOT_FOUND');
  } finally {
    await api.close();
  }
});

test('GET /v1/controls/{id}/evidence filters on the attachment status', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const applied = await api.request('GET', '/v1/controls/CONT-01/evidence?status=APPLIED', {
      token: TOKENS.auditor
    });
    assert.equal(applied.status, 200);
    const invalid = await api.request('GET', '/v1/controls/CONT-01/evidence?status=WHATEVER', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('ENF-CONF-01: evidence above the caller clearance is omitted from the control listing', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await importDemoFramework(api);
    const restricted = makeEvidence({ id: 'ev-restricted-1', accessLevel: 'RESTRICTED' });
    await services.state.putEvidence(restricted);
    await services.state.putAttachment(
      makeAttachment({ id: 'at-restricted-1', evidenceId: restricted.id, controlId: 'CONT-01' })
    );
    const asAuditor = await api.request('GET', '/v1/controls/CONT-01/evidence', { token: TOKENS.auditor });
    assert.equal(asAuditor.status, 200);
    const rows = asAuditor.json as Array<{ id: string }>;
    assert.ok(!rows.some((row) => row.id === restricted.id), 'the restricted evidence is omitted');
    const asLead = await api.request('GET', '/v1/controls/CONT-01/evidence', { token: TOKENS.qualityLead });
    const leadRows = asLead.json as Array<{ id: string }>;
    assert.ok(leadRows.some((row) => row.id === restricted.id), 'the quality lead reads it');
  } finally {
    await api.close();
  }
});

test('EF-REL-02: remind sends a reminder listing what the owner must provide', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const payload = frameworkPayload();
    payload.controls = payload.controls.filter((control) => control.id === 'CONT-03');
    await api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: payload });
    const response = await api.request('POST', '/v1/controls/CONT-03/remind', {
      token: TOKENS.qualityLead,
      body: { reason: 'NO_EVIDENCE' }
    });
    assert.equal(response.status, 201);
    const reminder = response.json as {
      id: string;
      controlId: string;
      frameworkId: string;
      reason: string;
      recipient: string;
      missing: string[];
      message: string;
      status: string;
    };
    assert.match(reminder.id, /^rm-/);
    assert.equal(reminder.controlId, 'CONT-03');
    assert.equal(reminder.frameworkId, 'demo-msp');
    assert.equal(reminder.reason, 'NO_EVIDENCE');
    assert.equal(reminder.recipient, 'ops.lead');
    assert.ok(reminder.message.length > 0);
    const sent = await services.notifier.sent();
    assert.equal(sent.length, 1, 'the reminder went through the notifier');
  } finally {
    await api.close();
  }
});

test('POST /v1/controls/{id}/remind is 409 when no reminder is due', async () => {
  const services = makeTestServices();
  const pipeline = makeStubPipeline({ runReminders: async () => [] });
  const api = await startTestApi({ services, pipeline });
  try {
    await services.state.putFramework(makeFramework());
    await services.state.putControls([makeControl({ id: 'CONT-01' })]);
    const response = await api.request('POST', '/v1/controls/CONT-01/remind', {
      token: TOKENS.qualityLead,
      body: {}
    });
    assert.equal(response.status, 409);
    assert.equal((response.json as { error: { code: string } }).error.code, 'CONFLICT');
    assert.equal((await services.notifier.sent()).length, 0, 'nothing was sent');
  } finally {
    await api.close();
  }
});

test('EF-REL-01: an internal auditor may not send a reminder', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('POST', '/v1/controls/CONT-01/remind', {
      token: TOKENS.auditor,
      body: {}
    });
    assert.equal(response.status, 403);
    const denials = await api.services.audit.list({ action: 'ACCESS_DENIED' });
    assert.equal(denials.length, 1);
  } finally {
    await api.close();
  }
});

test('POST /v1/controls/{id}/remind is 404 for an unknown control', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('POST', '/v1/controls/CONT-42/remind', {
      token: TOKENS.qualityLead,
      body: {}
    });
    assert.equal(response.status, 404);
  } finally {
    await api.close();
  }
});
