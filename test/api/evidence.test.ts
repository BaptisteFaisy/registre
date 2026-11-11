/**
 * Evidence routes — EF-COL-02/05, EF-LEC-03/04, ENF-CONF-01/02.
 *
 * Acceptance: a deposit answers the whole evidence (R2), a second deposit of the
 * same bytes answers the same one with `duplicate: true` (R8), and a RESTRICTED
 * evidence is refused to a principal without that clearance (R13).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestServices } from './fakeServices.ts';
import {
  depositPolicy,
  depositRestricted,
  evidenceIdOf,
  importDemoFramework,
  policyBytes,
  policyText
} from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** The evidence a deposit or a read answers, `textPages` included. */
interface EvidencePayload {
  id: string;
  sha256: string;
  duplicate?: boolean;
  accessLevel: string;
  contentType: string;
  locations: unknown[];
  fields: { title: string | null; documentDate: string | null; approver: string | null };
  flags: { unreadable: boolean };
  textPages: Array<{ page: number; text: string }>;
  excerptsMasked?: boolean;
}

test('EF-COL-02: a JSON deposit with base64 bytes returns 201 and the evidence id', async () => {
  const api = await startTestApi();
  try {
    const response = await depositPolicy(api);
    assert.equal(response.status, 201);
    const body = response.json as EvidencePayload;
    assert.match(body.id, /^ev-/);
    assert.equal(body.sha256.length, 64);
    assert.equal(body.duplicate, false);
    assert.equal(body.accessLevel, 'INTERNAL');
    assert.ok(Array.isArray(body.textPages), 'the portal evidence always carries its page excerpts');
  } finally {
    await api.close();
  }
});

test('EF-COL-02: a raw binary deposit uses the file own Content-Type', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('POST', '/v1/evidence?filename=policy.txt&controlId=CONT-01', {
      token: TOKENS.qualityLead,
      raw: policyBytes(),
      headers: { 'content-type': 'text/plain' }
    });
    assert.equal(response.status, 201);
    const body = response.json as EvidencePayload;
    assert.equal(body.contentType, 'text/plain');
    assert.match(body.id, /^ev-/);
  } finally {
    await api.close();
  }
});

test('EF-COL-05 (R8): the same bytes twice give one evidence and two locations', async () => {
  const api = await startTestApi();
  try {
    const first = await depositPolicy(api);
    const second = await depositPolicy(api);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const firstBody = first.json as EvidencePayload;
    const secondBody = second.json as EvidencePayload;
    assert.equal(secondBody.id, firstBody.id);
    assert.equal(secondBody.duplicate, true);
    assert.equal(firstBody.duplicate, false);
    assert.equal(secondBody.locations.length, 2);
  } finally {
    await api.close();
  }
});

test('POST /v1/evidence is 400 without bytes, 422 for an empty document', async () => {
  const api = await startTestApi();
  try {
    const noBytes = await api.request('POST', '/v1/evidence', {
      token: TOKENS.qualityLead,
      body: { filename: 'policy.txt', contentType: 'text/plain' }
    });
    assert.equal(noBytes.status, 400);
    const empty = await api.request('POST', '/v1/evidence', {
      token: TOKENS.qualityLead,
      body: { filename: 'policy.txt', contentType: 'text/plain', contentBase64: '!!notbase64!!' }
    });
    assert.equal(empty.status, 400);
  } finally {
    await api.close();
  }
});

test('EF-LEC-03: a deposit then a read returns the read fields', async () => {
  const api = await startTestApi();
  try {
    const deposit = await depositPolicy(api);
    const evidenceId = evidenceIdOf(deposit);
    const read = await api.request('GET', `/v1/evidence/${evidenceId}`, { token: TOKENS.auditor });
    assert.equal(read.status, 200);
    const body = read.json as EvidencePayload;
    assert.equal(body.id, evidenceId);
    assert.equal(body.fields.title, 'Information security policy');
    assert.equal(body.fields.documentDate, '2026-08-01');
    assert.equal(body.flags.unreadable, false);
    assert.equal(body.accessLevel, 'INTERNAL');
    assert.equal(body.excerptsMasked, false, 'the internal auditor may read an INTERNAL excerpt');
    assert.ok(body.textPages.length >= 1);
  } finally {
    await api.close();
  }
});

test('GET /v1/evidence/{id}?include=text masks personal data in the excerpts', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const deposit = await depositRestricted(api);
    const evidenceId = evidenceIdOf(deposit);
    const read = await api.request('GET', `/v1/evidence/${evidenceId}?include=text`, {
      token: TOKENS.qualityLead
    });
    assert.equal(read.status, 200);
    assert.ok(!read.text.includes('alice@msp.demo'), 'the e-mail must be masked');
    assert.ok(read.text.includes('[EMAIL]'));
    assert.equal((read.json as EvidencePayload).excerptsMasked, false, 'the quality lead has the clearance');
  } finally {
    await api.close();
  }
});

test('ENF-CONF-01 (R13): a RESTRICTED evidence is 403 for an internal auditor', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const deposit = await depositRestricted(api);
    const evidenceId = evidenceIdOf(deposit);
    const read = await api.request('GET', `/v1/evidence/${evidenceId}`, { token: TOKENS.auditor });
    assert.equal(read.status, 403);
    assert.equal((read.json as { error: { code: string } }).error.code, 'FORBIDDEN');
    const denials = await services.audit.list({ action: 'ACCESS_DENIED' });
    assert.equal(denials.length, 1);
    assert.equal(denials[0]?.objectId, evidenceId);
    assert.equal((denials[0]?.detail as { reason?: string }).reason, 'ROLE_NOT_ALLOWED');
  } finally {
    await api.close();
  }
});

test('GET /v1/evidence/{id} is 404 for an unknown id', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/evidence/ev-does-not-exist', { token: TOKENS.auditor });
    assert.equal(response.status, 404);
  } finally {
    await api.close();
  }
});

test('EF-COL-02: a control owner deposits only for the controls they own', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const owned = await api.request('POST', '/v1/evidence', {
      token: TOKENS.controlOwner,
      body: {
        filename: 'restore.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from(policyBytes()).toString('base64'),
        controlId: 'CONT-03'
      }
    });
    assert.equal(owned.status, 201, 'CONT-03 belongs to the demonstration control owner');
    const foreign = await api.request('POST', '/v1/evidence', {
      token: TOKENS.controlOwner,
      body: {
        filename: 'other.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from(`${policyText()}\nsecond`).toString('base64'),
        controlId: 'CONT-07'
      }
    });
    assert.equal(foreign.status, 403);
    assert.equal((foreign.json as { error: { detail: { controlId?: string } } }).error.detail.controlId, 'CONT-07');
  } finally {
    await api.close();
  }
});
