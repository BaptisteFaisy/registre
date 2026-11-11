import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, HttpRegistreApi } from './client.ts';
import { base64ToBytes, utf8ToBytes } from '../lib/base64.ts';
import { jsonResponse, stubFetch } from './fetchStub.ts';
import type { Evidence } from './types.ts';

const BASE_URL = 'https://api.registre.example';

/** A document that is not valid UTF-8, as a scan is. */
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x7f, 0x80, 0xff]);

function sampleEvidence(): Evidence {
  return {
    id: 'ev-001',
    sha256: 'a'.repeat(64),
    revision: 1,
    fields: {
      type: 'REPORT',
      title: 'Backup restore test report',
      documentDate: '2026-11-01',
      period: { start: null, end: null },
      version: null,
      author: null,
      approver: null,
      approvalDate: null,
      client: null,
      summary: null,
      personalData: false
    },
    flags: { unreadable: false, missingDate: false, missingAuthor: false, dateToConfirm: false },
    accessLevel: 'INTERNAL',
    locations: [{ kind: 'MANUAL', uri: 'manual://restore-test.pdf', collectedAt: '2026-11-11T09:00:00.000Z' }],
    textPages: [],
    sizeBytes: BYTES.length,
    contentType: 'application/pdf',
    ingestedAt: '2026-11-11T09:00:00.000Z',
    reader: 'bedrock-data-automation'
  };
}

test('a deposit posts the document inside the JSON envelope', async () => {
  const stub = stubFetch(jsonResponse(201, sampleEvidence()));
  const api = new HttpRegistreApi({ baseUrl: BASE_URL, fetchImpl: stub.fetchImpl });

  const created = await api.uploadEvidence({
    fileName: 'restore-test.pdf',
    contentType: 'application/pdf',
    bytes: BYTES,
    suggestedControlId: 'BCP-02',
    accessLevel: 'INTERNAL',
    fileDate: '2026-11-01'
  });
  assert.equal(created.id, 'ev-001');

  const call = stub.only();
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/v1/evidence`);
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers['Accept'], 'application/json');

  const body = stub.onlyBody();
  assert.deepEqual(Object.keys(body).sort(), [
    'accessLevel',
    'contentBase64',
    'contentType',
    'controlId',
    'fileDate',
    'filename',
    'sizeBytes'
  ]);
  assert.equal(body.filename, 'restore-test.pdf');
  assert.equal(body.contentType, 'application/pdf');
  assert.equal(body.sizeBytes, BYTES.length);
  assert.equal(body.controlId, 'BCP-02');
  assert.equal(body.accessLevel, 'INTERNAL');
  assert.equal(body.fileDate, '2026-11-01');
  assert.deepEqual(base64ToBytes(String(body.contentBase64)), BYTES);
});

test('the envelope omits the fields the portal does not know', async () => {
  const stub = stubFetch(jsonResponse(201, sampleEvidence()));
  const api = new HttpRegistreApi({
    baseUrl: `${BASE_URL}/`,
    tokens: { token: () => 'tok-123' },
    fetchImpl: stub.fetchImpl
  });

  const bytes = utf8ToBytes('a small text note');
  await api.uploadEvidence({
    fileName: 'note.txt',
    contentType: 'text/plain',
    bytes,
    fileDate: null
  });

  const call = stub.only();
  assert.equal(call.url, `${BASE_URL}/v1/evidence`);
  assert.equal(call.headers['Authorization'], 'Bearer tok-123');
  const body = stub.onlyBody();
  assert.deepEqual(Object.keys(body).sort(), ['contentBase64', 'contentType', 'filename', 'sizeBytes']);
  assert.equal(body.filename, 'note.txt');
  assert.equal(body.sizeBytes, bytes.length);
  assert.deepEqual(base64ToBytes(String(body.contentBase64)), bytes);
});

test('a duplicate deposit returns the stored evidence with 200', async () => {
  const stub = stubFetch(jsonResponse(200, sampleEvidence()));
  const api = new HttpRegistreApi({ baseUrl: BASE_URL, fetchImpl: stub.fetchImpl });
  const existing = await api.uploadEvidence({
    fileName: 'restore-test.pdf',
    contentType: 'application/pdf',
    bytes: BYTES
  });
  assert.equal(existing.sha256, sampleEvidence().sha256);
});

test('a 401 surfaces as an ApiError and ends the session', async () => {
  let ended = 0;
  const stub = stubFetch(jsonResponse(401, { code: 'UNAUTHORIZED', message: 'Session expired.' }));
  const api = new HttpRegistreApi({
    baseUrl: BASE_URL,
    fetchImpl: stub.fetchImpl,
    onUnauthorized: () => {
      ended += 1;
    }
  });

  await assert.rejects(
    () => api.listFrameworks(),
    (error: unknown) =>
      error instanceof ApiError && error.isUnauthorized && error.message === 'Session expired.'
  );
  assert.equal(ended, 1);
});

test('a successful call never ends the session', async () => {
  let ended = 0;
  const stub = stubFetch(jsonResponse(200, []));
  const api = new HttpRegistreApi({
    baseUrl: BASE_URL,
    fetchImpl: stub.fetchImpl,
    onUnauthorized: () => {
      ended += 1;
    }
  });
  await api.listFrameworks();
  assert.equal(ended, 0);
});
