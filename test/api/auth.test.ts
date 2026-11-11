/**
 * Authentication and authorisation — EF-ADM-03 (demonstration identities),
 * spec chapter 6 (roles), ENF-CONF-01 (access levels).
 *
 * Acceptance: no token is 401, a known principal with the wrong role is 403 and
 * the refusal is written to the audit log as `ACCESS_DENIED`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_IDENTITIES, DemoDirectory, SESSION_COOKIE, demoDirectory, demoToken } from '../../src/api/auth.ts';
import type { Principal } from '../../src/domain/types.ts';
import { makeStubPipeline } from './fakePipeline.ts';
import { TOKENS, startTestApi } from './harness.ts';

test('EF-ADM-03: four demonstration identities, one per role', () => {
  const credentials = demoDirectory().demoCredentials();
  assert.equal(credentials.length, 4);
  assert.deepEqual(credentials.map((entry) => entry.role).sort(), [
    'ADMIN',
    'CONTROL_OWNER',
    'INTERNAL_AUDITOR',
    'QUALITY_LEAD'
  ]);
  for (const entry of credentials) assert.ok(entry.password.length >= 8, 'a demo password is at least 8 characters');
});

test('EF-ADM-03: a bearer token resolves to its principal', () => {
  const directory = demoDirectory();
  const quality = DEMO_IDENTITIES[0];
  assert.ok(quality);
  const principal = directory.authenticate(demoToken(quality.principal.email, quality.password));
  assert.equal(principal?.id, quality.principal.id);
  assert.equal(principal?.role, 'QUALITY_LEAD');
  assert.equal(directory.authenticate('not-a-token'), null);
  assert.equal(directory.authenticate(demoToken(quality.principal.email, 'wrong')), null);
});

test('EF-ADM-03: the same token is accepted as a session cookie', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('GET', '/v1/validations', {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(TOKENS.qualityLead)}` },
      token: null
    });
    assert.equal(response.status, 200);
  } finally {
    await api.close();
  }
});

test('401: a request without a credential is refused', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('GET', '/v1/validations', { token: null });
    assert.equal(response.status, 401);
    assert.equal((response.json as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
  } finally {
    await api.close();
  }
});

test('401: an unknown token is refused', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('GET', '/v1/frameworks', { token: 'forged-token' });
    assert.equal(response.status, 401);
  } finally {
    await api.close();
  }
});

test('403: a role that may not decide gets ACCESS_DENIED in the audit log', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('POST', '/v1/validations/va-1/decision', {
      token: TOKENS.auditor,
      body: { decision: 'ACCEPT' }
    });
    assert.equal(response.status, 403);
    assert.equal((response.json as { error: { code: string } }).error.code, 'FORBIDDEN');
    const events = await api.services.audit.list({ action: 'ACCESS_DENIED' });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.actor, 'u-auditor');
    assert.equal(events[0]?.objectId, 'va-1');
    assert.equal((events[0]?.detail as { role?: string }).role, 'INTERNAL_AUDITOR');
  } finally {
    await api.close();
  }
});

test('403: an executive reads the readiness but may not assemble a pack', async () => {
  const executive: Principal = {
    id: 'u-exec',
    name: 'Executive',
    email: 'executive@msp.demo',
    role: 'EXECUTIVE',
    clearance: 'INTERNAL',
    ownedControls: []
  };
  const directory = new DemoDirectory([...DEMO_IDENTITIES, { principal: executive, password: 'exec-demo' }]);
  const api = await startTestApi({ pipeline: makeStubPipeline(), directory });
  const token = demoToken(executive.email, 'exec-demo');
  try {
    const read = await api.request('GET', '/v1/validations', { token });
    assert.equal(read.status, 403, 'the validation queue is not open to the executive role');
    const pack = await api.request('POST', '/v1/frameworks/demo-msp/packs', { token, body: {} });
    assert.equal(pack.status, 403);
    const denials = await api.services.audit.list({ action: 'ACCESS_DENIED' });
    assert.equal(denials.length, 2);
  } finally {
    await api.close();
  }
});

test('403: a control owner may not import a framework', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('POST', '/v1/frameworks', {
      token: TOKENS.controlOwner,
      body: { framework: { id: 'f', name: 'n', version: '1' }, controls: [] }
    });
    assert.equal(response.status, 403);
    const denials = await api.services.audit.list({ action: 'ACCESS_DENIED' });
    assert.ok(denials.some((event) => event.actor === 'u-owner'));
  } finally {
    await api.close();
  }
});
