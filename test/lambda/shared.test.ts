/**
 * Shared plumbing of the adapters — the response shape, the payload reading and
 * the guarantee that no handler ever throws out of an invocation.
 *
 * Offline: the bundle is injected with `setLambdaServices`, and the error
 * mapping is checked against the codes `RegistreError` carries, which
 * `src/api/errors.ts` turns into HTTP statuses — the same statuses the API
 * answers with, so a Lambda and an endpoint never disagree.
 */

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badRequest,
  configError,
  conflict,
  forbidden,
  notFound,
  RegistreError,
  unreadable,
  upstream
} from '../../src/support/errors.ts';
import {
  bytesOf,
  chainPayload,
  errorResponse,
  pipelinePayloadOf,
  readPayload,
  setLambdaServices
} from '../../src/lambda/shared.ts';
import type { LambdaResponse } from '../../src/lambda/shared.ts';
import type { Services } from '../../src/ports/index.ts';
import { makeTestServices } from '../api/fakeServices.ts';
import { handler as ingest } from '../../src/lambda/ingest.ts';
import { handler as read } from '../../src/lambda/read.ts';
import { handler as candidates } from '../../src/lambda/candidates.ts';
import { handler as attach } from '../../src/lambda/attach.ts';
import { handler as sufficiency } from '../../src/lambda/sufficiency.ts';
import { handler as states } from '../../src/lambda/states.ts';
import { handler as reminders } from '../../src/lambda/reminders.ts';
import { handler as collectS3 } from '../../src/lambda/collectS3.ts';
import { handler as collectItsm } from '../../src/lambda/collectItsm.ts';
import { handler as collectAwsReport } from '../../src/lambda/collectAwsReport.ts';
import { handler as indexEvidence } from '../../src/lambda/indexEvidence.ts';

/** Every adapter of `src/lambda`: the table `infra/lib/config.ts` points at. */
const ADAPTERS: ReadonlyArray<{ name: string; handler: (event: unknown) => Promise<LambdaResponse> }> = [
  { name: 'ingest', handler: ingest },
  { name: 'read', handler: read },
  { name: 'candidates', handler: candidates },
  { name: 'attach', handler: attach },
  { name: 'sufficiency', handler: sufficiency },
  { name: 'states', handler: states },
  { name: 'reminders', handler: reminders },
  { name: 'collectS3', handler: collectS3 },
  { name: 'collectItsm', handler: collectItsm },
  { name: 'collectAwsReport', handler: collectAwsReport },
  { name: 'indexEvidence', handler: indexEvidence }
];

/** One domain error and the HTTP status it must become. */
const ERROR_CASES: ReadonlyArray<{ error: RegistreError; status: number }> = [
  { error: badRequest('nope'), status: 400 },
  { error: forbidden('nope'), status: 403 },
  { error: notFound('nope'), status: 404 },
  { error: conflict('nope'), status: 409 },
  { error: unreadable('nope'), status: 422 },
  { error: upstream('nope'), status: 502 },
  { error: configError('nope'), status: 502 }
];

/** Events no adapter may accept, and none of them may make one throw. */
const INVALID_EVENTS: readonly unknown[] = [
  undefined,
  null,
  'text',
  42,
  [],
  { payload: 'not-an-object' },
  { payload: [] },
  { payload: null }
];

function bodyOf(response: LambdaResponse): { error?: { code: string; detail: Record<string, unknown> } } {
  return JSON.parse(response.body) as { error?: { code: string; detail: Record<string, unknown> } };
}

/** A bundle whose reader fails, to check that a failure never escapes a handler. */
function brokenServices(failure: unknown): Services {
  const services = makeTestServices();
  return {
    ...services,
    reader: {
      id: 'broken-reader',
      read: async () => {
        throw failure;
      }
    }
  };
}

const READ_EVENT = { payload: { uri: 's3://b/policy.md', contentType: 'text/plain', kind: 'S3' } };

beforeEach(() => {
  setLambdaServices(makeTestServices());
});

afterEach(() => {
  setLambdaServices(null);
});

test('every adapter exports a handler function', () => {
  for (const adapter of ADAPTERS) {
    assert.equal(typeof adapter.handler, 'function', `${adapter.name} exports no handler`);
  }
});

test('no adapter throws, whatever the event is: always a structured 400', async () => {
  for (const adapter of ADAPTERS) {
    for (const event of INVALID_EVENTS) {
      const response = await adapter.handler(event);
      assert.equal(response.statusCode, 400, `${adapter.name} on ${JSON.stringify(event)}`);
      assert.equal(response.ok, false);
      assert.equal(bodyOf(response).error?.code, 'BAD_REQUEST');
      assert.deepEqual(response.payload, {});
    }
  }
});

test('every RegistreError code becomes the HTTP status of the API', () => {
  for (const testCase of ERROR_CASES) {
    const response = errorResponse(testCase.error);
    assert.equal(response.statusCode, testCase.status);
    assert.equal(response.ok, false);
    assert.equal(bodyOf(response).error?.code, testCase.error.code);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  }
});

test('an unexpected throwable becomes 500 INTERNAL, without leaking the stack', () => {
  const response = errorResponse(new TypeError('a secret internal detail'));

  assert.equal(response.statusCode, 500);
  assert.equal(bodyOf(response).error?.code, 'INTERNAL');
  assert.equal(bodyOf(response).error?.detail.reason, 'a secret internal detail');
  assert.equal(bodyOf(response).error?.detail.stack, undefined);
});

test('a domain error raised inside a step becomes its status, not an exception', async () => {
  setLambdaServices(brokenServices(unreadable('the document cannot be read')));

  const response = await read(READ_EVENT);

  assert.equal(response.statusCode, 422);
  assert.equal(response.ok, false);
  assert.equal(bodyOf(response).error?.code, 'UNREADABLE');
});

test('an unexpected failure inside a step becomes 500 INTERNAL', async () => {
  setLambdaServices(brokenServices(new TypeError('boom')));

  const response = await read(READ_EVENT);

  assert.equal(response.statusCode, 500);
  assert.equal(bodyOf(response).error?.code, 'INTERNAL');
});

test('the payload is read from event.payload, and from the event itself as a fallback', () => {
  assert.deepEqual(readPayload({ payload: { uri: 'a' } }), { uri: 'a' });
  assert.deepEqual(readPayload({ uri: 'a' }), { uri: 'a' });
  assert.throws(() => readPayload(null), /not an object/);
  assert.throws(() => readPayload([]), /not an object/);
  assert.throws(() => readPayload({ payload: [] }), /no payload object/);
});

test('document bytes come from base64 or from a byte array, never from a guess', () => {
  const text = 'policy';
  assert.deepEqual(bytesOf({ bytesBase64: Buffer.from(text).toString('base64') }), new TextEncoder().encode(text));
  assert.deepEqual(bytesOf({ bytes: [104, 105] }), new Uint8Array([104, 105]));
  assert.equal(bytesOf({}), null);
  assert.throws(() => bytesOf({ bytesBase64: 'not base64!' }), /not valid base64/);
  assert.throws(() => bytesOf({ bytes: [999] }), /array of bytes/);
});

test('the chain payload carries bytes as base64, so it survives a JSON round-trip', () => {
  const payload = pipelinePayloadOf({
    uri: 's3://b/policy.md',
    contentType: 'text/markdown',
    kind: 'S3',
    bytesBase64: Buffer.from('policy').toString('base64'),
    evidenceId: 'ev-123456789abc'
  });
  assert.equal(payload.uri, 's3://b/policy.md');
  assert.equal(payload.evidenceId, 'ev-123456789abc');

  const serialised = JSON.parse(JSON.stringify(chainPayload(payload, { duplicate: false }))) as Record<string, unknown>;
  assert.equal(serialised.bytes, undefined);
  assert.equal(typeof serialised.bytesBase64, 'string');

  const next = pipelinePayloadOf(serialised);
  assert.deepEqual(next.bytes, payload.bytes);
  assert.equal(next.duplicate, false);
});

test('a payload without provenance, or with an unknown kind, is rejected', () => {
  assert.throws(() => pipelinePayloadOf({ contentType: 'text/plain' }), /uri/);
  assert.throws(() => pipelinePayloadOf({ uri: 'a', kind: 'FAX' }), /kind/);
});
