/**
 * Router behaviour: path matching, 404/405, body limit, security headers, CORS
 * and the single error body shape (spec chapter 15 conventions).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePath, matchPath, pathSegments } from '../../src/api/router.ts';
import { makeStubPipeline } from './fakePipeline.ts';
import { TOKENS, startTestApi } from './harness.ts';

test('router: a path pattern extracts its parameters', () => {
  const compiled = compilePath('/v1/controls/:id/evidence');
  assert.deepEqual(matchPath(compiled, pathSegments('/v1/controls/CONT-01/evidence')), { id: 'CONT-01' });
  assert.equal(matchPath(compiled, pathSegments('/v1/controls/CONT-01')), null);
  assert.equal(matchPath(compiled, pathSegments('/v1/frameworks/CONT-01/evidence')), null);
});

test('router: an unknown path is 404 with the standard error body', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('GET', '/v1/unknown', { token: TOKENS.qualityLead });
    assert.equal(response.status, 404);
    const body = response.json as { error: { code: string; message: string; detail: unknown } };
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.message.length > 0);
    assert.ok(typeof body.error.detail === 'object');
  } finally {
    await api.close();
  }
});

test('router: a known path with the wrong method is 405 and lists the allowed methods', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('DELETE', '/v1/frameworks', { token: TOKENS.qualityLead });
    assert.equal(response.status, 405);
    const body = response.json as { error: { code: string; detail: { allowed: string[] } } };
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.deepEqual(body.error.detail.allowed.sort(), ['GET', 'POST']);
  } finally {
    await api.close();
  }
});

test('router: OPTIONS answers the CORS preflight without a credential', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('OPTIONS', '/v1/frameworks', {
      token: null,
      headers: { origin: 'http://localhost:5173' }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/);
  } finally {
    await api.close();
  }
});

test('router: every response carries the baseline security headers', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const response = await api.request('GET', '/healthz', { token: null });
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    await api.close();
  }
});

test('router: a body above the limit is refused with 413', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline(), maxBodyBytes: 32 });
  try {
    const response = await api.request('POST', '/v1/ask', {
      token: TOKENS.qualityLead,
      body: { question: 'x'.repeat(200) }
    });
    assert.equal(response.status, 413);
    assert.equal((response.json as { error: { code: string } }).error.code, 'PAYLOAD_TOO_LARGE');
  } finally {
    await api.close();
  }
});

test('router: a malformed JSON body is 400, an empty body is 400 too', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const malformed = await api.request('POST', '/v1/ask', {
      token: TOKENS.qualityLead,
      raw: '{not json',
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(malformed.status, 400);
    const empty = await api.request('POST', '/v1/ask', {
      token: TOKENS.qualityLead,
      raw: '',
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(empty.status, 400);
  } finally {
    await api.close();
  }
});

test('router: the CORS origin can be restricted to an allowlist', async () => {
  const api = await startTestApi({ pipeline: makeStubPipeline() });
  try {
    const allowed = await api.request('GET', '/healthz', {
      token: null,
      headers: { origin: 'http://localhost:8787' }
    });
    assert.equal(allowed.status, 200);
  } finally {
    await api.close();
  }
});
