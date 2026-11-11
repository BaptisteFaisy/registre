/**
 * Chain task adapters — `ingest`, `read`, `candidates`, `attach`,
 * `sufficiency`, `states`, `reminders`, `indexEvidence`.
 *
 * Offline: the bundle is injected with `setLambdaServices`, the AI layer is the
 * deterministic mock. What is checked here is the adapter contract, not the
 * pipeline rules (those are covered by `test/pipeline/**`):
 *  - a minimal Step Functions event (`{ payload: {...} }`) gives a usable answer;
 *  - an invalid event gives a structured error, never a thrown exception;
 *  - `indexEvidence` never claims an index it did not perform.
 */

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Services } from '../../src/ports/index.ts';
import { makeControl, makeFramework, TEST_NOW } from '../fixtures/builders.ts';
import { makeTestServices } from '../api/fakeServices.ts';
import { setLambdaServices } from '../../src/lambda/shared.ts';
import type { LambdaResponse } from '../../src/lambda/shared.ts';
import { KB_SOURCE_PREFIX_ENV, NOT_CONFIGURED_REASON } from '../../src/lambda/indexEvidence.ts';
import { handler as ingest } from '../../src/lambda/ingest.ts';
import { handler as read } from '../../src/lambda/read.ts';
import { handler as candidates } from '../../src/lambda/candidates.ts';
import { handler as attach } from '../../src/lambda/attach.ts';
import { handler as sufficiency } from '../../src/lambda/sufficiency.ts';
import { handler as states } from '../../src/lambda/states.ts';
import { handler as reminders } from '../../src/lambda/reminders.ts';
import { handler as indexEvidence } from '../../src/lambda/indexEvidence.ts';

/** A readable policy document, in the format the offline reader understands. */
const DOCUMENT = [
  '---',
  'Title: Information security policy',
  'Type: POLICY',
  'Date: 2026-08-01',
  'Period: 2026-01-01..2026-12-31',
  'Author: A. Dupont',
  'Approved by: C. Bernard',
  'Approval date: 2026-08-05',
  'Summary: Annual review approved by the steering committee.',
  '---',
  'The information security policy is reviewed and approved at least once a year.',
  ''
].join('\n');

const DOCUMENT_B64 = Buffer.from(DOCUMENT).toString('base64');

/** The smallest valid event of a chain task. */
const MINIMAL = { uri: 's3://registre-source/policy.md', contentType: 'text/markdown', kind: 'S3' };

/** Injects a fresh offline bundle with one framework and one control. */
async function seededServices(): Promise<Services> {
  const services = makeTestServices({ now: TEST_NOW });
  await services.state.putFramework(makeFramework({ id: 'demo-msp' }));
  await services.state.putControls([makeControl({ id: 'CONT-01', frameworkId: 'demo-msp' })]);
  setLambdaServices(services);
  return services;
}

/** Ingests the sample document and returns the payload the chain carries on. */
async function ingestedPayload(): Promise<Record<string, unknown>> {
  const response = await ingest({ payload: { ...MINIMAL, bytesBase64: DOCUMENT_B64 } });
  assert.equal(response.statusCode, 200);
  return response.payload;
}

function errorOf(response: LambdaResponse): { code: string; message: string } {
  return JSON.parse(response.body).error as { code: string; message: string };
}

afterEach(() => {
  setLambdaServices(null);
  delete process.env[KB_SOURCE_PREFIX_ENV];
});

test('ingest: a minimal event ingests the document and reports the chain fields', async () => {
  await seededServices();
  const response = await ingest({ payload: { ...MINIMAL, bytesBase64: DOCUMENT_B64 } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.ok, true);
  assert.equal(response.duplicate, false);
  assert.match(String(response.evidenceId), /^ev-[0-9a-f]{12}$/);
  assert.match(String(response.sha256), /^[0-9a-f]{64}$/);
  assert.equal(response.payload.uri, MINIMAL.uri);
  assert.ok(response.payload.evidence);
});

test('ingest: the same bytes deposited twice give one evidence, two locations (R8)', async () => {
  await seededServices();
  const first = await ingest({ ...MINIMAL, uri: 's3://b/first.md', bytes: Array.from(Buffer.from(DOCUMENT)) });
  const second = await ingest({ payload: { ...MINIMAL, uri: 's3://b/second.md', bytesBase64: DOCUMENT_B64 } });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.evidenceId, first.evidenceId);
  assert.equal(second.payload.uri, 's3://b/second.md');
});

test('ingest: an event without document bytes is a structured 400', async () => {
  await seededServices();
  const response = await ingest({ payload: { uri: 's3://registre-source/policy.md', kind: 'S3' } });

  assert.equal(response.statusCode, 400);
  assert.equal(response.ok, false);
  assert.equal(errorOf(response).code, 'BAD_REQUEST');
  assert.match(errorOf(response).message, /bytes/);
});

test('ingest: an unknown source kind is a structured 400', async () => {
  await seededServices();
  const response = await ingest({ payload: { ...MINIMAL, kind: 'FAX', bytesBase64: DOCUMENT_B64 } });

  assert.equal(response.statusCode, 400);
  assert.equal(errorOf(response).code, 'BAD_REQUEST');
});

test('read: a minimal event reads the document and carries the evidence on', async () => {
  await seededServices();
  const response = await read({ payload: { ...MINIMAL, bytesBase64: DOCUMENT_B64 } });

  assert.equal(response.statusCode, 200);
  const evidence = response.payload.evidence as { id: string; reader: string };
  assert.match(evidence.id, /^ev-[0-9a-f]{12}$/);
  assert.equal(evidence.reader, 'mock-scripted-reader');
});

test('read: an event without provenance is a structured 400', async () => {
  await seededServices();
  const response = await read({ payload: { contentType: 'text/plain', kind: 'MANUAL' } });

  assert.equal(response.statusCode, 400);
  assert.equal(errorOf(response).code, 'BAD_REQUEST');
});

test('candidates: a minimal event returns the retrieved controls', async () => {
  await seededServices();
  const response = await candidates({ payload: await ingestedPayload() });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.candidates));
  assert.ok(Array.isArray(response.payload.candidates));
});

test('attach: a minimal event returns the attachments it verified', async () => {
  await seededServices();
  const response = await attach({ payload: await ingestedPayload() });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.attachments));
});

test('sufficiency: a minimal event returns the sufficiencies it computed', async () => {
  await seededServices();
  const response = await sufficiency({ payload: await ingestedPayload() });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.sufficiencies));
});

test('states: a minimal event returns the recomputed statuses', async () => {
  await seededServices();
  const response = await states({ payload: await ingestedPayload() });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.statuses));
  assert.ok(Array.isArray(response.payload.statuses));
});

test('reminders: the default action sends what is due today', async () => {
  await seededServices();
  const response = await reminders({ payload: {} });

  assert.equal(response.statusCode, 200);
  assert.equal(response.action, 'reminders');
  // The seeded control has no evidence yet: EF-REL-02 reminds its owner.
  assert.equal((response.reminders as { sent: number }).sent, 1);
});

test('reminders: an unknown action is a structured 400, never a silent no-op', async () => {
  await seededServices();
  const response = await reminders({ payload: { action: 'broadcast' } });

  assert.equal(response.statusCode, 400);
  assert.equal(errorOf(response).code, 'BAD_REQUEST');
});

test('reminders: the digest needs a framework, and 404s on an unknown one', async () => {
  await seededServices();
  const missing = await reminders({ payload: { action: 'digest' } });
  assert.equal(missing.statusCode, 400);
  assert.match(errorOf(missing).message, /frameworkId/);

  const unknown = await reminders({ payload: { action: 'digest', frameworkId: 'nope' } });
  assert.equal(unknown.statusCode, 404);
  assert.equal(errorOf(unknown).code, 'NOT_FOUND');
});

test('reminders: the digest of a known framework composes the weekly point', async () => {
  await seededServices();
  const response = await reminders({ payload: { action: 'digest', frameworkId: 'demo-msp' } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.action, 'digest');
  assert.equal((response.digest as { to: string }).to, 'quality.lead@msp.demo');
});

test('indexEvidence: without a source prefix it reports indexed=false and why', async () => {
  await seededServices();
  delete process.env[KB_SOURCE_PREFIX_ENV];
  const response = await indexEvidence({ payload: { ...MINIMAL, bytesBase64: DOCUMENT_B64 } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.indexed, false);
  assert.equal(response.deposited, undefined);
  assert.equal(response.reason, NOT_CONFIGURED_REASON);
});

test('indexEvidence: with a source prefix it deposits a copy and still claims no index', async () => {
  const services = await seededServices();
  process.env[KB_SOURCE_PREFIX_ENV] = 'knowledge-base/evidence';
  const response = await indexEvidence({
    payload: { ...MINIMAL, evidenceId: 'ev-123456789abc', bytesBase64: DOCUMENT_B64 }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.indexed, false);
  assert.equal(response.deposited, true);
  assert.match(String(response.sourceUri), /^memory:\/\/knowledge-base\/evidence\/ev-123456789abc\.markdown/);
  const stored = await services.evidenceStore.list('memory://knowledge-base/evidence');
  assert.equal(stored.length > 0, true);
});

test('indexEvidence: a configured prefix and no bytes is reported, not invented', async () => {
  await seededServices();
  process.env[KB_SOURCE_PREFIX_ENV] = 'knowledge-base/evidence';
  const response = await indexEvidence({ payload: { ...MINIMAL } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.indexed, false);
  assert.equal(response.deposited, undefined);
  assert.match(String(response.reason), /no document bytes/);
});
