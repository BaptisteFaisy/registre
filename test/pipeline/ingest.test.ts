/**
 * Ingestion — EF-COL-05, R8 ("document en double : un seul enregistrement, deux
 * emplacements notés") and the nominal chain of spec 11.4 (read, attach,
 * assess, recompute).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestEvidence } from '../../src/pipeline/ingest.ts';
import type { IngestInput } from '../../src/pipeline/types.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, seed } from './fakeServices.ts';

const POLICY_TEXT = 'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';

const CONTROL = makeControl({ id: 'CONT-01', mandatory: false, periodicity: 'P1Y' });

const PROPOSAL = {
  controlId: 'CONT-01',
  supports: true,
  confidence: 0.93,
  quote: 'reviewed on 1 August 2026 and approved by C. Bernard'
};

function input(overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    bytes: new TextEncoder().encode(POLICY_TEXT),
    contentType: 'application/pdf',
    uri: 'manual://policy.pdf',
    kind: 'MANUAL',
    fileName: 'policy.pdf',
    ...overrides
  };
}

/** Bundle with the policy control and a scripted reader/reasoner. */
function bundle(overrides: Parameters<typeof fakeServices>[0] = {}) {
  return fakeServices({
    controls: [CONTROL],
    read: { pages: [{ page: 1, text: POLICY_TEXT }] },
    proposals: [PROPOSAL],
    elements: [
      { expected: 'Policy title', present: true, quote: 'Information security policy version 3.1' },
      { expected: 'Review date', present: true, quote: 'reviewed on 1 August 2026' },
      { expected: 'Approver name', present: true, quote: 'approved by C. Bernard' },
      { expected: 'Version', present: true, quote: 'version 3.1' }
    ],
    ...overrides
  });
}

test('nominal ingestion reads, stores, attaches, assesses and recomputes', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const result = await ingestEvidence(services, input(), 'quality.lead');

  assert.equal(result.duplicateOf, null);
  assert.match(result.evidence.id, /^ev-[0-9a-f]{12}$/);
  assert.equal(result.evidence.revision, 1);
  assert.equal(result.evidence.accessLevel, 'INTERNAL');
  assert.equal(result.evidence.reader, 'fake-reader');
  assert.equal(result.evidence.locations[0]?.kind, 'MANUAL');
  assert.equal(result.evidence.locations[0]?.uri, `vault://evidence/${result.evidence.id}/v1.pdf#v1`);

  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0]?.status, 'APPLIED');
  assert.equal(result.attachments[0]?.citationVerified, true);
  assert.equal(result.attachments[0]?.quoteLocation.page, 1, 'the page comes from the quote check, not the model');
  assert.equal(result.attachments[0]?.autoApplied, true);

  assert.equal(result.sufficiencies.length, 1);
  assert.equal(result.sufficiencies[0]?.class, 'COMPLETE');
  assert.deepEqual(result.sufficiencies[0]?.missing, []);

  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0]?.state, 'COVERED', 'fresh and complete evidence covers a non-mandatory control');
  assert.deepEqual(result.validationItems, []);
});

test('ingestion journals the deposit, the reading with its cost, and the attachment', async () => {
  const services = bundle({ read: { pages: [{ page: 1, text: POLICY_TEXT }], cost: { usd: 0.015, tokensIn: 0, tokensOut: 0, source: 'fake-reader' } } });
  await seed(services, [CONTROL]);
  await ingestEvidence(services, input(), 'quality.lead');

  const actions = services.events().map((event) => event.action);
  assert.deepEqual(actions, [
    'EVIDENCE_COLLECTED',
    'EVIDENCE_READ',
    'ATTACHMENT_APPLIED',
    'STATE_RECOMPUTED'
  ]);
  assert.equal(services.events('EVIDENCE_READ')[0]?.detail.costUsd, 0.015);
  assert.equal(services.costs.report().count, 1, 'the reading cost is metered (ENF-COUT-01)');
});

test('a document carrying personal data is stored at RESTRICTED level', async () => {
  const services = bundle({ read: { pages: [{ page: 1, text: POLICY_TEXT }], fields: { personalData: true } } });
  await seed(services, [CONTROL]);
  const result = await ingestEvidence(services, input(), 'quality.lead');
  assert.equal(result.evidence.accessLevel, 'RESTRICTED');
});

test('the vault object is written with the retention of the settings (ENF-INT-01)', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const result = await ingestEvidence(services, input(), 'quality.lead');
  assert.deepEqual(services.vaultKeys(), [`vault://evidence/${result.evidence.id}/v1.pdf#v1`]);
  const collected = services.events('EVIDENCE_COLLECTED')[0];
  assert.equal(collected?.detail.retainDays, 731, '24 months from 2026-11-11 is 731 days');
});

test('R8: the same bytes twice give one evidence and two locations', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  const first = await ingestEvidence(services, input(), 'quality.lead');
  const second = await ingestEvidence(services, input({ uri: 's3://bucket/copy-of-policy.pdf', kind: 'S3' }), 'collector.s3');

  assert.equal(second.duplicateOf, first.evidence.id);
  assert.equal(second.evidence.id, first.evidence.id);
  assert.equal(second.evidence.revision, 2);
  assert.equal(second.evidence.locations.length, 2);
  assert.equal(second.evidence.locations[1]?.duplicate, true);
  assert.equal(second.evidence.locations[1]?.kind, 'S3');
  assert.deepEqual(second.attachments, [], 'a duplicate spends no model token');

  const stored = await services.state.listEvidence();
  assert.equal(stored.length, 1, 'one record only');
  assert.equal(services.events('EVIDENCE_READ').length, 1, 'the document is read once');
  assert.equal(services.events('EVIDENCE_DUPLICATE').length, 1);
  assert.equal(services.events('EVIDENCE_DUPLICATE')[0]?.detail.revision, 2);
});

test('an empty document is refused before anything is stored', async () => {
  const services = bundle();
  await seed(services, [CONTROL]);
  await assert.rejects(() => ingestEvidence(services, input({ bytes: new Uint8Array() }), 'quality.lead'), {
    code: 'UNREADABLE'
  });
  assert.deepEqual(services.vaultKeys(), []);
});
