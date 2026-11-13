/**
 * Feeding the knowledge bases — EF-RAT-01, EF-QR-01. No network: the S3 and
 * Bedrock clients are fakes that record the commands they receive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Control, Evidence } from '../../src/domain/types.ts';
import { controlFromMetadata } from '../../src/ai/bedrock/knowledgeBase.ts';
import {
  controlDocument,
  evidenceDocuments,
  evidenceTarget,
  frameworksTarget,
  metadataBody,
  putSourceDocuments,
  startIngestion
} from '../../src/ai/bedrock/knowledgeSync.ts';

const CONTROL: Control = {
  id: 'CONT-19',
  frameworkId: 'demo-msp',
  domain: 'Operations',
  title: 'Backup jobs complete and are monitored',
  requirement: 'Backup jobs are monitored monthly.',
  expectedEvidence: ['Backup job count', 'Failed job count'],
  periodicity: 'P1M',
  owner: 'Operations Lead',
  mandatory: true
};

test('EF-RAT-01 a control document carries the metadata retrieval rebuilds the control from', () => {
  const document = controlDocument(CONTROL);
  assert.equal(document.key, 'controls/demo-msp/CONT-19.txt');
  assert.deepEqual(controlFromMetadata(document.metadata), CONTROL);
  assert.deepEqual(JSON.parse(metadataBody(document.metadata)).metadataAttributes.controlId, 'CONT-19');
});

test('EF-QR-01 an evidence is indexed page by page, with its access level and page number', () => {
  const evidence = {
    id: 'ev-1',
    revision: 2,
    accessLevel: 'RESTRICTED',
    fields: { title: 'Access review', documentDate: '2026-09-30' },
    textPages: [{ page: 1, text: 'first' }, { page: 2, text: '  ' }, { page: 3, text: 'third' }]
  } as unknown as Evidence;
  const documents = evidenceDocuments(evidence, 'kb-evidence/');
  assert.deepEqual(documents.map((d) => d.key), ['kb-evidence/ev-1/r2-p1.txt', 'kb-evidence/ev-1/r2-p3.txt']);
  assert.deepEqual(documents[1]?.metadata, { evidenceId: 'ev-1', accessLevel: 'RESTRICTED', page: '3', title: 'Access review', documentDate: '2026-09-30' });
});

test('EF-RAT-01 each document is written with its sidecar, checksummed for Object Lock', async () => {
  const sent: Array<{ Key: string; ChecksumAlgorithm: string }> = [];
  const s3 = { send: async (command: { input: { Key: string; ChecksumAlgorithm: string } }) => sent.push(command.input) };
  const written = await putSourceDocuments(s3 as never, 'bucket', [controlDocument(CONTROL)]);
  assert.equal(written, 1);
  assert.deepEqual(sent.map((input) => input.Key), ['controls/demo-msp/CONT-19.txt', 'controls/demo-msp/CONT-19.txt.metadata.json']);
  assert.ok(sent.every((input) => input.ChecksumAlgorithm === 'SHA256'));
});

test('EF-RAT-01 a sync already running is reported, not raised; other errors are raised', async () => {
  const conflict = Object.assign(new Error('busy'), { name: 'ConflictException' });
  const client = (startError: Error | null) => ({
    send: async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'ListDataSourcesCommand') return { dataSourceSummaries: [{ dataSourceId: 'ds-1' }] };
      if (startError) throw startError;
      return {};
    }
  });
  assert.deepEqual(await startIngestion(client(null) as never, 'kb'), ['started']);
  assert.deepEqual(await startIngestion(client(conflict) as never, 'kb'), ['already-running']);
  await assert.rejects(startIngestion(client(new Error('denied')) as never, 'kb'), /denied/);
});

test('EF-RAT-01 the feeds are configured by the environment only', () => {
  const env = { REGISTRE_REGION: 'eu-central-1', REGISTRE_KB_FRAMEWORKS_ID: 'kb-f', REGISTRE_FRAMEWORKS_BUCKET: 'fw' };
  assert.deepEqual(frameworksTarget(env), { knowledgeBaseId: 'kb-f', bucket: 'fw', prefix: 'controls/', region: 'eu-central-1' });
  assert.equal(evidenceTarget(env), null);
  assert.equal(frameworksTarget({ REGISTRE_REGION: 'eu-central-1' }), null);
});
