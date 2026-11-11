/**
 * Server and Lambda adapters.
 *
 * The local server binds an ephemeral loopback port; the Lambda handler adapts
 * an API Gateway HTTP API v2 event to the same internal request, so an
 * endpoint behaves identically in both. The S3 trigger ingests the objects of a
 * notification through the same pipeline as a manual deposit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFromEnv, createServer } from '../../src/api/server.ts';
import { handler, resetLambdaCache, toApiRequestFromEvent, toLambdaResult } from '../../src/api/lambda.ts';
import { contentTypeOf, decodeKey } from '../../src/api/lambdaS3.ts';
import { makeTestServices } from './fakeServices.ts';
import { TOKENS } from './harness.ts';

test('server: PORT and HOST come from the environment, with safe defaults', () => {
  assert.deepEqual(addressFromEnv({}), { port: 8787, host: '127.0.0.1' });
  assert.deepEqual(addressFromEnv({ PORT: '9000', HOST: '0.0.0.0' }), { port: 9000, host: '0.0.0.0' });
  assert.deepEqual(addressFromEnv({ PORT: 'not-a-port' }), { port: 8787, host: '127.0.0.1' });
});

test('server: the router is built from the standard route table', () => {
  const server = createServer(makeTestServices(), { port: 0 });
  const paths = server.router.routes().map((route) => `${route.method} ${route.path}`);
  assert.ok(paths.includes('GET /healthz'));
  assert.ok(paths.includes('POST /v1/evidence'));
  assert.ok(paths.length >= 20);
});

test('lambda: an API Gateway event becomes the same internal request', () => {
  const request = toApiRequestFromEvent({
    version: '2.0',
    rawPath: '/v1/frameworks',
    rawQueryString: 'confidentiality=INTERNAL',
    headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    requestContext: { http: { method: 'GET', path: '/v1/frameworks' } }
  });
  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/v1/frameworks');
  assert.equal(request.query.confidentiality, 'INTERNAL');
  assert.equal(request.headers.authorization, 'Bearer x');
});

test('lambda: a base64 body is decoded, and cookies become one header', () => {
  const request = toApiRequestFromEvent({
    rawPath: '/v1/ask',
    headers: {},
    cookies: ['registre_session=abc', 'other=1'],
    body: Buffer.from('{"question":"why?"}', 'utf8').toString('base64'),
    isBase64Encoded: true,
    requestContext: { http: { method: 'POST' } }
  });
  assert.equal(new TextDecoder().decode(request.body), '{"question":"why?"}');
  assert.equal(request.headers.cookie, 'registre_session=abc; other=1');
});

test('lambda: the handler answers like the local server', async () => {
  resetLambdaCache();
  const result = await handler({
    version: '2.0',
    rawPath: '/healthz',
    headers: {},
    requestContext: { http: { method: 'GET' } }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.isBase64Encoded, false);
  const body = JSON.parse(result.body) as { status: string };
  assert.equal(body.status, 'ok');
});

test('lambda: a binary answer is base64 encoded', async () => {
  const result = await toLambdaResult({
    status: 200,
    headers: { 'content-type': 'application/zip' },
    body: 'zip-bytes'
  });
  assert.equal(result.isBase64Encoded, true);
  assert.equal(Buffer.from(result.body, 'base64').toString('utf8'), 'zip-bytes');
});

test('lambda: a missing credential answers 401 with the standard error body', async () => {
  resetLambdaCache();
  const result = await handler({
    rawPath: '/v1/frameworks',
    headers: {},
    requestContext: { http: { method: 'GET' } }
  });
  assert.equal(result.statusCode, 401);
  const body = JSON.parse(result.body) as { error: { code: string } };
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

test('lambda: the bearer token of a demonstration identity works', async () => {
  resetLambdaCache();
  const result = await handler({
    rawPath: '/v1/frameworks',
    headers: { authorization: `Bearer ${TOKENS.qualityLead}` },
    requestContext: { http: { method: 'GET' } }
  });
  assert.equal(result.statusCode, 200);
});

test('s3: the key decoding and the content type guess follow the S3 rules', () => {
  assert.equal(decodeKey('evidence/rapport%20annuel.pdf'), 'evidence/rapport annuel.pdf');
  assert.equal(contentTypeOf('a/b/c.pdf'), 'application/pdf');
  assert.equal(contentTypeOf('a/b/c.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(contentTypeOf('a/b/c.unknown'), 'application/octet-stream');
});
