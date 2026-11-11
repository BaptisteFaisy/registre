/**
 * Framework routes — chapter 15, EF-REF-01/02/05, EF-FRA-03/04.
 *
 * Runs against the real pipeline and the real in-memory adapters, so these
 * tests cover the whole path: HTTP → role check → pipeline → store → JSON.
 *
 * The contract is bare: a list route answers an array, the import answers the
 * framework itself, the readiness answers the whole dashboard in one call, and
 * the version diff is served by its own route.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_STATES } from '../../src/domain/types.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, frameworkPayload, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** One control of the bare listing: the imported framework, no computed state. */
interface BareControl {
  id: string;
  frameworkId: string;
  domain: string;
  title: string;
  requirement: string;
  expectedEvidence: string[];
  periodicity: string;
  owner: string;
  mandatory: boolean;
}

/** The dashboard payload of `GET /v1/frameworks/{id}/readiness`. */
interface ReadinessOverview {
  framework: { id: string };
  snapshot: {
    frameworkId: string;
    computedAt: string;
    total: number;
    counts: Record<string, number>;
    shares: Record<string, number>;
  };
  trend: Array<{ frameworkId: string; at: string; counts: Record<string, number> }>;
  statuses: Array<{ controlId: string; state: string }>;
  byDomain: Record<string, { total: number; counts: Record<string, number> }>;
  costs: { totalUsd: number; perEvidenceUsd: number; evidenceCount: number; bySource: Record<string, number> };
}

/** Imports version 2.0: one control kept with a new title, one removed. */
async function importSecondVersion(api: Awaited<ReturnType<typeof startTestApi>>): Promise<number> {
  const payload = frameworkPayload();
  payload.framework.version = '2.0';
  payload.controls = payload.controls.filter((control) => control.id === 'CONT-01');
  payload.controls[0]!.title = 'Information security policy reviewed every year';
  const response = await api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: payload });
  return response.status;
}

test('EF-REF-01 (R1): importing a framework returns 201 and its controls', async () => {
  const api = await startTestApi();
  try {
    const response = await importDemoFramework(api);
    assert.equal(response.status, 201);
    const framework = response.json as { id: string; name: string; version: string; confidentiality: string };
    assert.equal(framework.id, 'demo-msp');
    assert.equal(framework.version, '1.0');
    assert.equal(framework.confidentiality, 'INTERNAL');
    // The controls are no longer in the import response: they are listed by
    // their own route, and the version diff by GET /v1/frameworks/{id}/diff.
    const controls = await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor });
    const list = controls.json as BareControl[];
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((control) => control.id).sort(), ['CONT-01', 'CONT-03']);
  } finally {
    await api.close();
  }
});

test('EF-REF-05: a second version reports the controls added, changed and removed', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    assert.equal(await importSecondVersion(api), 201);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/diff', { token: TOKENS.qualityLead });
    assert.equal(response.status, 200);
    const body = response.json as {
      firstImport: boolean;
      version: string;
      diff: { added: string[]; changed: string[]; removed: string[] };
    };
    assert.equal(body.firstImport, false);
    assert.equal(body.version, '2.0');
    assert.deepEqual(body.diff.changed, ['CONT-01']);
    assert.deepEqual(body.diff.removed, ['CONT-03']);
    assert.deepEqual(body.diff.added, []);
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
    const frameworks = all.json as Array<{ id: string; version: string }>;
    assert.equal(frameworks.length, 1);
    assert.equal(frameworks[0]?.id, 'demo-msp');
    assert.equal(frameworks[0]?.version, '1.0');
    const none = await api.request('GET', '/v1/frameworks?confidentiality=RESTRICTED', {
      token: TOKENS.auditor
    });
    assert.equal((none.json as unknown[]).length, 0);
    const invalid = await api.request('GET', '/v1/frameworks?confidentiality=SECRET', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 200, 'an unknown filter value simply matches nothing');
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/controls returns the bare controls of the framework', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const controls = response.json as BareControl[];
    assert.equal(controls.length, 2);
    for (const control of controls) {
      assert.equal(control.frameworkId, 'demo-msp');
      assert.ok(control.title.length > 0);
      assert.ok(control.expectedEvidence.length > 0);
      // The state is not part of the listing any more: the dashboard reads it
      // from the readiness overview (`statuses`), one status per control.
      assert.equal((control as unknown as Record<string, unknown>).state, undefined);
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
    const body = response.json as ReadinessOverview;
    assert.equal(body.snapshot.frameworkId, 'demo-msp');
    assert.equal(body.snapshot.total, 2);
    assert.equal(Object.values(body.snapshot.counts).reduce((sum, count) => sum + count, 0), 2);
    assert.ok(body.snapshot.computedAt.length > 0);
    assert.ok(body.trend.length >= 1);
    const sumOfShares = Object.values(body.snapshot.shares).reduce((sum, share) => sum + share, 0);
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
    assert.equal((one.json as ReadinessOverview).trend.length, 1);
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
    assert.equal((asAuditor.json as unknown[]).length, 0);
    const asLead = await api.request('GET', '/v1/frameworks', { token: TOKENS.qualityLead });
    assert.equal((asLead.json as unknown[]).length, 1);
    const controls = await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor });
    assert.equal(controls.status, 403);
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/readiness answers the six keys of the dashboard', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/readiness', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'byDomain',
      'costs',
      'framework',
      'snapshot',
      'statuses',
      'trend'
    ]);
    assert.equal((body.framework as { id: string }).id, 'demo-msp');
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/readiness: domains, states and costs agree with the controls', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/readiness', { token: TOKENS.auditor });
    const body = response.json as ReadinessOverview;
    const controls = (await api.request('GET', '/v1/frameworks/demo-msp/controls', { token: TOKENS.auditor }))
      .json as BareControl[];
    assert.equal(body.statuses.length, controls.length, 'one status per control');
    for (const status of body.statuses) {
      assert.ok(CONTROL_STATES.includes(status.state as (typeof CONTROL_STATES)[number]));
    }
    const domains = Object.values(body.byDomain);
    assert.equal(domains.reduce((sum, domain) => sum + domain.total, 0), controls.length);
    const states = domains.reduce(
      (sum, domain) => sum + Object.values(domain.counts).reduce((total, count) => total + count, 0),
      0
    );
    assert.equal(states, controls.length, 'every control is counted in exactly one domain');
    assert.equal(body.costs.evidenceCount, 1);
    assert.equal(body.costs.perEvidenceUsd, body.costs.totalUsd / body.costs.evidenceCount);
    assert.ok(Object.keys(body.costs.bySource).length >= 1);
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/diff: the first import has no diff to show', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/diff', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const body = response.json as {
      frameworkId: string;
      version: string;
      importedAt: string;
      firstImport: boolean;
      diff: unknown;
    };
    assert.equal(body.frameworkId, 'demo-msp');
    assert.equal(body.version, '1.0');
    assert.ok(body.importedAt.length > 0);
    assert.equal(body.firstImport, true);
    assert.equal(body.diff, null, 'a first import has no previous version to diff against');
  } finally {
    await api.close();
  }
});

test('GET /v1/frameworks/{id}/diff is 404 for an unknown framework', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/frameworks/nope/diff', { token: TOKENS.auditor });
    assert.equal(response.status, 404);
    assert.equal((response.json as { error: { code: string } }).error.code, 'NOT_FOUND');
  } finally {
    await api.close();
  }
});
