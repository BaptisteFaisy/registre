/**
 * Control routes — EF-FRA-02, EF-RAT-02, EF-REL-01/02.
 *
 * `GET /v1/controls/{id}` returns the control and its state, the evidence route
 * lists the attachments with their sufficiency, and `remind` sends a reminder
 * listing what the owner must provide.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAttachment, makeEvidence } from '../fixtures/builders.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, frameworkPayload, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

test('EF-FRA-02: GET /v1/controls/{id} returns the control and its state', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/controls/CONT-01', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as {
      control: { id: string; periodicity: string; expectedEvidence: string[] };
      status: { controlId: string; state: string; computedAt: string };
    };
    assert.equal(body.control.id, 'CONT-01');
    assert.equal(body.control.periodicity, 'P1Y');
    assert.equal(body.status.controlId, 'CONT-01');
    assert.equal(body.status.state, 'NO_EVIDENCE');
    assert.ok(body.status.computedAt.length > 0);
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

test('EF-RAT-02: the evidence of a control carries its quote and sufficiency', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const response = await api.request('GET', '/v1/controls/CONT-01/evidence', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as {
      controlId: string;
      total: number;
      attachments: Array<{
        attachmentId: string;
        evidenceId: string;
        status: string;
        quote: string;
        citationVerified: boolean;
        sufficiency: { class: string; missing: string[] } | null;
      }>;
    };
    assert.equal(body.controlId, 'CONT-01');
    assert.ok(body.total >= 1);
    const attachment = body.attachments[0];
    assert.ok(attachment);
    assert.match(attachment.attachmentId, /^at-/);
    assert.ok(['PROPOSED', 'APPLIED', 'REJECTED'].includes(attachment.status));
    assert.ok(attachment.quote.length > 0, 'a proposal always carries its quote (EF-RAT-02)');
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
    const rows = (asAuditor.json as { attachments: Array<{ evidenceId: string }> }).attachments;
    assert.ok(!rows.some((row) => row.evidenceId === restricted.id), 'the restricted evidence is omitted');
    const asLead = await api.request('GET', '/v1/controls/CONT-01/evidence', { token: TOKENS.qualityLead });
    const leadRows = (asLead.json as { attachments: Array<{ evidenceId: string }> }).attachments;
    assert.ok(leadRows.some((row) => row.evidenceId === restricted.id), 'the quality lead reads it');
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
    assert.equal(response.status, 202);
    const body = response.json as {
      controlId: string;
      sent: number;
      reminders: Array<{ reason: string; recipient: string; message: string }>;
    };
    assert.equal(body.controlId, 'CONT-03');
    assert.equal(body.sent, 1);
    assert.equal(body.reminders[0]?.reason, 'NO_EVIDENCE');
    assert.equal(body.reminders[0]?.recipient, 'ops.lead');
    assert.ok((body.reminders[0]?.message.length ?? 0) > 0);
    const sent = await services.notifier.sent();
    assert.equal(sent.length, 1, 'the reminder went through the notifier');
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
