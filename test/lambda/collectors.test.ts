/**
 * Collector adapters — `collectS3`, `collectItsm`, `collectAwsReport`.
 *
 * No network here: each test injects a collector through `setLambdaCollector`,
 * so the adapters run the real `runCollectors` (fingerprint, duplicates,
 * journal — EF-COL-05, R8, ENF-OBS-01) over deterministic files. The tests
 * that inject nothing check the honest failure instead: a collector whose source
 * is not configured answers a structured `CONFIG` error, it never dials out.
 */

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Collector, CollectorCursor } from '../../src/collectors/index.ts';
import { collectedFile } from '../../src/collectors/index.ts';
import type { CollectorKind } from '../../src/domain/types.ts';
import type { Services } from '../../src/ports/index.ts';
import { makeTestServices } from '../api/fakeServices.ts';
import { TEST_NOW } from '../fixtures/builders.ts';
import { resetLambdaCollectors, setLambdaCollector, type CollectorKey } from '../../src/lambda/collectors.ts';
import { setLambdaServices } from '../../src/lambda/shared.ts';
import type { LambdaResponse } from '../../src/lambda/shared.ts';
import { handler as collectS3 } from '../../src/lambda/collectS3.ts';
import { handler as collectItsm } from '../../src/lambda/collectItsm.ts';
import { handler as collectAwsReport } from '../../src/lambda/collectAwsReport.ts';

/** Environment the real builders read; cleared so nothing can dial out. */
const SOURCE_ENV = [
  'SOURCE_BUCKET',
  'REGISTRE_SOURCE_BUCKET',
  'ITSM_SOURCE_URL',
  'ITSM_SOURCE_FILE',
  'AWS_REPORT_BUCKET'
] as const;

/** One collected file, as a response reports it (no bytes). */
interface ReportedFile {
  key: string;
  uri: string;
  sha256: string;
  sizeBytes: number;
  duplicateOf: string | null;
}

/** A collector over fixed documents, recording the cursor it received. */
function fakeCollector(
  key: CollectorKey,
  kind: CollectorKind,
  documents: readonly string[]
): Collector & { cursors: CollectorCursor[] } {
  const collector = {
    id: `collector-${key}`,
    kind,
    cursors: [] as CollectorCursor[],
    async collect(cursor?: CollectorCursor) {
      if (cursor !== undefined) collector.cursors.push(cursor);
      return documents.map((text, index) =>
        collectedFile({
          key: `${key}/${index}.txt`,
          uri: `${key}://${index}.txt`,
          kind,
          contentType: 'text/plain',
          bytes: new TextEncoder().encode(text),
          collectedAt: TEST_NOW
        })
      );
    }
  };
  return collector;
}

function errorOf(response: LambdaResponse): { code: string; message: string } {
  return JSON.parse(response.body).error as { code: string; message: string };
}

let services: Services;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  services = makeTestServices({ now: TEST_NOW });
  setLambdaServices(services);
  resetLambdaCollectors();
  for (const name of SOURCE_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  resetLambdaCollectors();
  setLambdaServices(null);
  for (const name of SOURCE_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

test('collectS3: runs the injected collector and reports every file', async () => {
  const collector = fakeCollector('collectS3', 'S3', ['policy text', 'procedure text']);
  setLambdaCollector('collectS3', collector);

  const response = await collectS3({ payload: { since: '2026-11-01T00:00:00.000Z' } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.collected, 2);
  assert.equal(response.duplicates, 0);
  assert.equal(response.succeeded, 1);
  assert.equal(response.failed, 0);
  assert.deepEqual(collector.cursors, [{ since: '2026-11-01T00:00:00.000Z' }]);

  const files = response.files as ReportedFile[];
  assert.equal(files.length, 2);
  assert.match(files[0]!.sha256, /^[0-9a-f]{64}$/);
  assert.equal(files[0]!.sizeBytes, 'policy text'.length);
  assert.equal(files[0]!.uri, 'collectS3://0.txt');
});

test('collectItsm: identical bytes are reported as one duplicate (R8)', async () => {
  setLambdaCollector('collectItsm', fakeCollector('collectItsm', 'ITSM', ['same export', 'same export']));

  const response = await collectItsm({ payload: {} });

  assert.equal(response.statusCode, 200);
  assert.equal(response.collected, 2);
  assert.equal(response.duplicates, 1);
  const files = response.files as ReportedFile[];
  assert.equal(files[0]!.duplicateOf, null);
  assert.equal(files[1]!.duplicateOf, files[0]!.key);
});

test('collectAwsReport: the run is journalled with the adapter as actor', async () => {
  setLambdaCollector('collectAwsReport', fakeCollector('collectAwsReport', 'AWS_REPORT', ['{"rows":[]}']));

  const response = await collectAwsReport({
    payload: { since: '2026-11-01T00:00:00.000Z', until: TEST_NOW }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.collected, 1);
  const events = await services.audit.list({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.action, 'EVIDENCE_COLLECTED');
  assert.equal(events[0]!.actor, 'lambda-collectAwsReport');
});

test('collectS3: an unconfigured source is a CONFIG error, not a network call', async () => {
  const response = await collectS3({ payload: {} });

  assert.equal(response.statusCode, 502);
  assert.equal(response.ok, false);
  assert.equal(errorOf(response).code, 'CONFIG');
  assert.match(errorOf(response).message, /SOURCE_BUCKET/);
});

test('collectItsm: an unconfigured export source is a CONFIG error', async () => {
  const response = await collectItsm({ payload: {} });

  assert.equal(response.statusCode, 502);
  assert.equal(errorOf(response).code, 'CONFIG');
  assert.match(errorOf(response).message, /ITSM_SOURCE_FILE/);
});

test('collectAwsReport: an unconfigured report bucket is a CONFIG error', async () => {
  const response = await collectAwsReport({ payload: {} });

  assert.equal(response.statusCode, 502);
  assert.equal(errorOf(response).code, 'CONFIG');
  assert.match(errorOf(response).message, /AWS_REPORT_BUCKET/);
});
