/**
 * Audit trail route — EF-ADM-02, ENF-INT-02.
 *
 * The body is the bare page of events, newest first; the pagination and the
 * chain verdict travel in the `x-audit-*` headers. The log pages (limit/offset),
 * filters on action and object, and can verify its own hash chain in the same
 * call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEvent } from '../../src/domain/types.ts';
import { InMemoryAuditSink } from '../../src/store/index.ts';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';
import type { TestResponse } from './harness.ts';

/** Pagination and chain headers of one audit page. */
interface AuditHeaders {
  total: number;
  limit: number;
  offset: number;
  chain: string | null;
}

/** Reads the pagination headers an audit page carries. */
function headersOf(response: TestResponse): AuditHeaders {
  return {
    total: Number(response.headers.get('x-audit-total')),
    limit: Number(response.headers.get('x-audit-limit')),
    offset: Number(response.headers.get('x-audit-offset')),
    chain: response.headers.get('x-audit-chain')
  };
}

/** Asserts the body is a bare array of events and returns it. */
function eventsOf(response: TestResponse): AuditEvent[] {
  assert.ok(Array.isArray(response.json), 'the body of an audit page is a bare array');
  return response.json as AuditEvent[];
}

test('EF-ADM-02: GET /v1/audit-log pages through the log, newest first', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const first = await api.request('GET', '/v1/audit-log?limit=2&offset=0', { token: TOKENS.auditor });
    assert.equal(first.status, 200);
    const events = eventsOf(first);
    const headers = headersOf(first);
    assert.equal(headers.limit, 2);
    assert.equal(headers.offset, 0);
    assert.equal(events.length, 2);
    assert.ok(headers.total > 2);
    assert.ok(events[0]!.seq > events[1]!.seq, 'the newest event comes first');
    assert.ok(events[0]!.hash.length === 64, 'every event carries its fingerprint');
  } finally {
    await api.close();
  }
});

test('EF-ADM-02: the body is a bare array and the pagination rides in the headers', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const response = await api.request('GET', '/v1/audit-log?limit=3', { token: TOKENS.auditor });
    const body = response.json as unknown;
    assert.ok(Array.isArray(body), 'no envelope any more');
    const headers = headersOf(response);
    assert.equal(headers.limit, 3);
    assert.equal(headers.offset, 0);
    assert.equal((body as unknown[]).length, 3, 'the page holds the limit it asked for');
    assert.ok(headers.total >= (body as unknown[]).length, 'the total counts the whole log');
    assert.equal(headers.chain, null, 'the chain is only verified on demand');
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
    const page = eventsOf(first);
    const headers = headersOf(first);
    assert.ok(headers.total > 2, 'the log holds more than one page');
    const second = await api.request('GET', `/v1/audit-log?limit=2&offset=${headers.offset + headers.limit}`, {
      token: TOKENS.auditor
    });
    const next = eventsOf(second);
    assert.equal(headersOf(second).offset, 2);
    const firstIds = page.map((event) => event.id);
    const nextIds = next.map((event) => event.id);
    assert.equal(nextIds.length, 2);
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
    const events = eventsOf(byAction);
    assert.ok(headersOf(byAction).total >= 1);
    assert.ok(events.length >= 1);
    for (const event of events) assert.equal(event.action, 'FRAMEWORK_IMPORTED');
    const byObject = await api.request('GET', '/v1/audit-log?objectId=demo-msp', {
      token: TOKENS.auditor
    });
    assert.ok(headersOf(byObject).total >= 1);
    for (const event of eventsOf(byObject)) assert.equal(event.objectId, 'demo-msp');
    const invalid = await api.request('GET', '/v1/audit-log?action=NOT_AN_ACTION', {
      token: TOKENS.auditor
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
  }
});

test('ENF-INT-02: ?verify=chain reports the chain verdict in a header', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/audit-log?verify=chain', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    assert.equal(headersOf(response).chain, 'ok');
    assert.ok(eventsOf(response).length >= 1);
  } finally {
    await api.close();
  }
});

test('ENF-INT-02: ?verify=chain reports the first broken sequence', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await importDemoFramework(api);
    const sink = services.audit as InMemoryAuditSink;
    const second = sink.entries()[1];
    assert.ok(second);
    second.detail.controls = 'tampered';
    const response = await api.request('GET', '/v1/audit-log?verify=chain', { token: TOKENS.auditor });
    assert.equal(headersOf(response).chain, `broken:${second.seq}`);
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
    const events = eventsOf(response);
    assert.ok(headersOf(response).total >= 1);
    assert.equal(events[0]?.action, 'ACCESS_DENIED');
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
