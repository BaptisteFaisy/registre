/**
 * The chain, step by step — spec 11.4. Each step is the same function the
 * deployed Step Functions chain runs, so the payload it produces is the
 * contract between two tasks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachStep,
  candidatesStep,
  fingerprintStep,
  readStep,
  statesStep,
  sufficiencyStep
} from '../../src/pipeline/steps.ts';
import type { PipelinePayload } from '../../src/pipeline/steps.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, seed } from './fakeServices.ts';

const POLICY_TEXT =
  'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';
const QUOTE = 'reviewed on 1 August 2026 and approved by C. Bernard';

const CONTROL = makeControl({ id: 'CONT-01', mandatory: false });

function payload(overrides: Partial<PipelinePayload> = {}): PipelinePayload {
  return {
    bytes: new TextEncoder().encode(POLICY_TEXT),
    uri: 'manual://policy.pdf',
    contentType: 'application/pdf',
    kind: 'MANUAL',
    fileName: 'policy.pdf',
    ...overrides
  };
}

function bundle(overrides: Parameters<typeof fakeServices>[0] = {}) {
  return fakeServices({
    controls: [CONTROL],
    read: { pages: [{ page: 1, text: POLICY_TEXT }] },
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.93, quote: QUOTE }],
    elements: [
      { expected: 'Policy title', present: true, quote: 'Information security policy version 3.1' },
      { expected: 'Review date', present: true, quote: 'reviewed on 1 August 2026' },
      { expected: 'Approver name', present: true, quote: 'approved by C. Bernard' },
      { expected: 'Version', present: true, quote: 'version 3.1' }
    ],
    ...overrides
  });
}

test('the fingerprint step stores the bytes and names the evidence (EF-COL-05)', async () => {
  const services = bundle();
  const result = await fingerprintStep(services, payload(), 'collector');

  assert.match(result.evidenceId, /^ev-[0-9a-f]{12}$/);
  assert.equal(result.duplicate, false);
  assert.equal(result.duplicateOf, null);
  assert.match(result.storedUri ?? '', /^vault:\/\/evidence\/ev-[0-9a-f]{12}\/v1\.pdf#v1$/);
});

test('the fingerprint step recognises the bytes it already knows (R8)', async () => {
  const services = bundle();
  const first = await fingerprintStep(services, payload(), 'collector');
  await readStep(services, { ...payload(), ...first }, 'collector');
  const second = await fingerprintStep(services, payload({ uri: 's3://bucket/copy.pdf', kind: 'S3' }), 'collector');

  assert.equal(second.duplicate, true);
  assert.equal(second.duplicateOf, first.evidenceId);
  assert.equal(second.storedUri, undefined, 'the duplicate step stores nothing');
  assert.equal(services.vaultKeys().length, 1, 'one object in the vault');
  assert.equal(services.events('EVIDENCE_DUPLICATE').length, 1);
});

test('the read step turns the stored bytes into an evidence with its fields', async () => {
  const services = bundle();
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');

  assert.equal(read.evidence.id, fingerprint.evidenceId);
  assert.equal(read.evidence.accessLevel, 'INTERNAL');
  assert.equal(read.evidence.reader, 'fake-reader');
  assert.equal(read.evidence.textPages.length, 1);
  assert.equal(read.evidence.locations[0]?.uri, fingerprint.storedUri);
  assert.equal(services.events('EVIDENCE_READ').length, 1);
});

test('the candidates step returns the controls of the framework (EF-RAT-01)', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');

  const candidates = await candidatesStep(services, { ...payload(), ...fingerprint, evidence: read.evidence });
  assert.deepEqual(candidates.candidates.map((candidate) => candidate.control.id), ['CONT-01']);
});

test('the attach step reuses the candidates of the previous step (one query)', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');
  const candidates = await candidatesStep(services, { ...payload(), ...fingerprint, evidence: read.evidence });

  let queries = 0;
  const original = services.controlRetriever.candidates.bind(services.controlRetriever);
  services.controlRetriever.candidates = async (input) => {
    queries += 1;
    return original(input);
  };

  const attached = await attachStep(
    services,
    { ...payload(), ...fingerprint, evidence: read.evidence, candidates: candidates.candidates },
    'collector'
  );

  assert.equal(queries, 0, 'the knowledge base is not queried twice');
  assert.equal(attached.attachments.length, 1);
});

test('the attach step applies a confident attachment (EF-RAT-03)', async () => {
  const services = bundle();
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');

  const attached = await attachStep(services, { ...payload(), ...fingerprint, evidence: read.evidence }, 'collector');
  assert.equal(attached.attachments.length, 1);
  assert.equal(attached.attachments[0]?.status, 'APPLIED');
});

test('the sufficiency step assesses every attachment (EF-SUF-01)', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');
  const attached = await attachStep(services, { ...payload(), ...fingerprint, evidence: read.evidence }, 'collector');

  const assessed = await sufficiencyStep(services, {
    ...payload(),
    ...fingerprint,
    evidence: read.evidence,
    attachments: attached.attachments
  });
  assert.equal(assessed.sufficiencies.length, 1);
  assert.equal(assessed.sufficiencies[0]?.class, 'COMPLETE');
});

test('the states step recomputes the frameworks the evidence touches (EF-FRA-02)', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const fingerprint = await fingerprintStep(services, payload(), 'collector');
  const read = await readStep(services, { ...payload(), ...fingerprint }, 'collector');
  const attached = await attachStep(services, { ...payload(), ...fingerprint, evidence: read.evidence }, 'collector');
  const withAttachments = { ...payload(), ...fingerprint, evidence: read.evidence, attachments: attached.attachments };
  await sufficiencyStep(services, withAttachments);

  const states = await statesStep(services, withAttachments);
  assert.equal(states.statuses.length, 1);
  assert.equal(states.statuses[0]?.state, 'COVERED');
});

test('a step without an evidence produces nothing rather than guessing', async () => {
  const services = bundle();
  assert.deepEqual((await candidatesStep(services, payload())).candidates, []);
  assert.deepEqual((await attachStep(services, payload(), 'collector')).attachments, []);
  assert.deepEqual((await sufficiencyStep(services, payload())).sufficiencies, []);
  assert.deepEqual((await statesStep(services, payload())).statuses, []);
});
