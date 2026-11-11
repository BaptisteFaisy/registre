/**
 * Audit trail route — EF-ADM-02, ENF-INT-02.
 *
 * The log pages (limit/offset), filters on action and object, and can verify
 * its own hash chain in the same call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEvent } from '../../src/domain/types.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** Shape of one audit page. */
interface AuditPage {
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  events: AuditEvent[];
  chain?: { ok: boolean; brokenAt: number | null };
}

test('EF-ADM-02: GET /v1/audit-log pages through the log, newest first', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const first = await api.request('GET', '/v1/audit-log?limit=2&offset=0', { token: TOKENS.auditor });
    assert.equal(first.status, 200);
    const page = first.json as AuditPage;
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 0);
    assert.equal(page.events.length, 2);
    assert.ok(page.total > 2);
    assert.equal(page.nextOffset, 2);
    assert.ok(page.events[0]!.seq > page.events[1]!.seq, 'the newest event comes first');
  } finally {
    await api.close();
  }
});

test('EF-ADM-02: the second page continues where the first stopped', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const first = await api.request('GET', '/v1/audit-log?limit=2&offset=0', { token: TOKENS.auditor });
    const page = first.json as AuditPage;
    assert.ok(page.total > 2, 'the log holds more than one page');
    assert.equal(page.nextOffset, 2);
    const second = await api.request('GET', `/v1/audit-log?limit=2&offset=${page.nextOffset}`, {
      token: TOKENS.auditor
    });
    const next = second.json as AuditPage;
    assert.equal(next.offset, 2);
    const firstIds = page.events.map((event) => event.id);
    const nextIds = next.events.map((event) => event.id);
    assert.ok(!firstIds.some((id) => nextIds.includes(id)), 'no event appears on two pages');
  } finally {
    await api.close();
  }
});

test('EF-ADM-02: the log filters on action and on object', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const byAction = await api.request('GET', '/v1/audit-log?action=FRAMEWORK_IMPORTED', {
      token: TOKENS.auditor
    });
    assert.equal(byAction.status, 200);
    const page = byAction.json as AuditPage;
    assert.ok(page.total >= 1);
    for (const event of page.events) assert.equal(event.action, 'FRAMEWORK_IMPORTED');
    const byObject = await api.request('GET', '/v1/audit-log?objectId=demo-msp', {
      token: TOKENS.auditor
    });
    assert.ok((byObject.json as AuditPage).total >= 1);
    const invalid = await api.request('GET', '/v1/audit-log?action=NOT_AN_ACTION', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('ENF-INT-02: ?verify=chain reports the chain verdict', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/audit-log?verify=chain', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const page = response.json as AuditPage;
    assert.ok(page.chain);
    assert.equal(page.chain.ok, true);
    assert.equal(page.chain.brokenAt, null);
  } finally {
    await api.close();
  }
});

test('EF-ADM-02: a quality lead sees the refusals in the log', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await api.request('POST', '/v1/frameworks', {
      token: TOKENS.controlOwner,
      body: { framework: { id: 'x', name: 'x', version: '1' }, controls: [] }
    });
    const response = await api.request('GET', '/v1/audit-log?action=ACCESS_DENIED', {
      token: TOKENS.qualityLead
    });
    const page = response.json as AuditPage;
    assert.ok(page.total >= 1);
    assert.equal(page.events[0]?.action, 'ACCESS_DENIED');
  } finally {
    await api.close();
  }
});

test('EF-ADM-02: the audit log is closed to a control owner', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/audit-log', { token: TOKENS.controlOwner });
    assert.equal(response.status, 403);
  } finally {
    await api.close();
  }
});
