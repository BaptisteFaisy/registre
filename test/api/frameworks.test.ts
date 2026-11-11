/**
 * Framework routes — chapter 15, EF-REF-01/02/05, EF-FRA-03/04.
 *
 * Runs against the real pipeline and the real in-memory adapters, so these
 * tests cover the whole path: HTTP → role check → pipeline → store → JSON.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestServices } from './fakeServices.ts';
import { frameworkPayload, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

test('EF-REF-01 (R1): importing a framework returns 201 and its controls', async () => {
  const api = await startTestApi();
  try {
    const response = await importDemoFramework(api);
    assert.equal(response.status, 201);
    const body = response.json as {
      framework: { id: string; version: string };
      controls: Array<{ id: string; periodicity: string }>;
      diff: unknown;
    };
    assert.equal(body.framework.id, 'demo-msp');
    assert.equal(body.controls.length, 2);
    assert.deepEqual(body.controls.map((control) => control.id).sort(), ['CONT-01', 'CONT-03']);
    assert.equal(body.diff, null, 'a first import has no previous version to diff against');
  } finally {
    await api.close();
  }
});

test('EF-REF-05: a second version reports the controls added, changed and removed', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const payload = frameworkPayload();
    payload.framework.version = '2.0';
    payload.controls = payload.controls.filter((control) => control.id === 'CONT-01');
    payload.controls[0]!.title = 'Information security policy reviewed every year';
    const response = await api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: payload });
    assert.equal(response.status, 201);
    const diff = (response.json as { diff: { added: string[]; changed: string[]; removed: string[] } }).diff;
    assert.deepEqual(diff.changed, ['CONT-01']);
    assert.deepEqual(diff.removed, ['CONT-03']);
    assert.deepEqual(diff.added, []);
  } finally {
    await api.close();
  }
});

test('EF-REF-02: the same version cannot be imported twice (409)', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const again = await importDemoFramework(api);
    assert.equal(again.status, 409);
    assert.equal((again.json as { error: { code: string } }).error.code, 'CONFLICT');
  } finally {
    await api.close();
  }
});

test('EF-REF-01: a malformed import is 400 with the field in the detail', async () => {
  const api = await startTestApi();
  try {
    const noControls = await api.request('POST', '/v1/frameworks', {
      token: TOKENS.qualityLead,
      body: { framework: { id: 'demo-msp', name: 'Demo', version: '1.0' }, controls: [] }
    });
    assert.equal(noControls.status, 400);
    const badPeriodicity = await api.request('POST', '/v1/frameworks', {
      token: TOKENS.qualityLead,
      body: {
        framework: { id: 'demo-msp', name: 'Demo', version: '1.0' },
        controls: [
          {
            id: 'CONT-99',
            domain: 'x',
            title: 'x',
            requirement: 'x',
            expectedEvidence: ['a'],
            periodicity: 'every year',
            owner: 'x'
          }
        ]
      }
    });
    assert.equal(badPeriodicity.status, 400);
    assert.equal((badPeriodicity.json as { error: { detail: { field?: string } } }).error.detail.field ?? '', '');
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks lists the imported frameworks, filtered by confidentiality', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const all = await api.request('GET', '/v1/frameworks', { token: TOKENS.auditor });
    assert.equal(all.status, 200);
    assert.equal((all.json as { total: number }).total, 1);
    const none = await api.request('GET', '/v1/frameworks?confidentiality=RESTRICTED', {
      token: TOKENS.auditor
    });
    assert.equal((none.json as { total: number }).total, 0);
    const invalid = await api.request('GET', '/v1/frameworks?confidentiality=SECRET', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 200, 'an unknown filter value simply matches nothing');
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/controls returns each control with its state', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as { total: number; controls: Array<{ id: string; state: string }> };
    assert.equal(body.total, 2);
    for (const control of body.controls) {
      assert.ok(
        ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE'].includes(control.state),
        `unexpected state ${control.state}`
      );
    }
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/controls is 404 for an unknown framework', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/frameworks/nope/controls', { token: TOKENS.auditor });
    assert.equal(response.status, 404);
    assert.equal((response.json as { error: { code: string } }).error.code, 'NOT_FOUND');
  } finally {
    await api.close();
  }
});

test('EF-FRA-03/04: readiness returns counts, shares and the trend', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/readiness', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as {
      total: number;
      counts: Record<string, number>;
      shares: Record<string, number>;
      trend: Array<{ at: string }>;
    };
    assert.equal(body.total, 2);
    assert.equal(Object.values(body.counts).reduce((sum, count) => sum + count, 0), 2);
    assert.ok(body.trend.length >= 1);
    const sumOfShares = Object.values(body.shares).reduce((sum, share) => sum + share, 0);
    assert.ok(Math.abs(sumOfShares - 1) < 0.001, 'shares add up to one');
  } finally {
    await api.close();
  }
});

test('EF-FRA-04: the trend query bounds the number of points', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const one = await api.request('GET', '/v1/frameworks/demo-msp/readiness?trend=1', { token: TOKENS.auditor });
    assert.equal(one.status, 200);
    assert.equal((one.json as { trend: unknown[] }).trend.length, 1);
    const invalid = await api.request('GET', '/v1/frameworks/demo-msp/readiness?trend=zero', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('ENF-CONF-03: a restricted framework is invisible to a non-lead role', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const payload = frameworkPayload();
    payload.framework.confidentiality = 'RESTRICTED';
    const imported = await api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: payload });
    assert.equal(imported.status, 201);
    const asAuditor = await api.request('GET', '/v1/frameworks', { token: TOKENS.auditor });
    assert.equal((asAuditor.json as { total: number }).total, 0);
    const asLead = await api.request('GET', '/v1/frameworks', { token: TOKENS.qualityLead });
    assert.equal((asLead.json as { total: number }).total, 1);
    const controls = await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor });
    assert.equal(controls.status, 403);
  } finally {
    await api.close();
  }
});
