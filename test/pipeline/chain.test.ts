/**
 * End-to-end chain — one framework, one document, one question, one pack, one
 * reminder. This is the acceptance walk of chapter 22 seen from the pipeline:
 * R1 (import) → R6 (no evidence, reminder) → R8 (duplicate) → R11 (cited
 * answer) → R14 (pack with verified fingerprints).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePack,
  askQuestion,
  ingestEvidence,
  importFramework,
  listValidationQueue,
  recomputeFramework,
  runReminders
} from '../../src/pipeline/index.ts';
import type { IngestInput } from '../../src/pipeline/types.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { makeControlInput, makeFrameworkImport } from '../fixtures/builders.ts';
import { fakeServices, passage, principal } from './fakeServices.ts';

const POLICY_TEXT =
  'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';

const QUOTE = 'reviewed on 1 August 2026 and approved by C. Bernard';

const CONTROLS = [
  makeControlInput({ id: 'CONT-01', owner: 'quality.lead', periodicity: 'P1Y', mandatory: false }),
  makeControlInput({
    id: 'CONT-03',
    title: 'Backups are tested by a real restore',
    requirement: 'A backup restore is performed and recorded every quarter.',
    expectedEvidence: ['Test date', 'Recovery time'],
    owner: 'ops.lead',
    periodicity: 'P3M',
    mandatory: false
  })
];

function document(overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    bytes: new TextEncoder().encode(POLICY_TEXT),
    contentType: 'application/pdf',
    uri: 'manual://policy.pdf',
    kind: 'MANUAL',
    fileName: 'policy.pdf',
    ...overrides
  };
}

/** Bundle wired as the demo is: catalogue, reader, reasoner, retriever, composer. */
function bundle() {
  return fakeServices({
    controls: [],
    read: { pages: [{ page: 1, text: POLICY_TEXT }] },
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.94, quote: QUOTE }],
    elements: [
      { expected: 'Policy title', present: true, quote: 'Information security policy version 3.1' },
      { expected: 'Review date', present: true, quote: 'reviewed on 1 August 2026' },
      { expected: 'Approver name', present: true, quote: 'approved by C. Bernard' },
      { expected: 'Version', present: true, quote: 'version 3.1' }
    ],
    passages: [passage()],
    draft: { text: `According to "Information security policy", page 1, dated 2026-08-01: "${QUOTE}"`, citations: [{ evidenceId: 'ev-1', quote: QUOTE, page: 1 }] }
  });
}

test('the whole chain runs from an import to a verified pack', async () => {
  const services = bundle();

  const imported = await importFramework(services, makeFrameworkImport(CONTROLS), 'quality.lead');
  assert.equal(imported.controls.length, 2);

  const before = await recomputeFramework(services, 'demo-msp');
  assert.deepEqual(before.readiness.counts, { COVERED: 0, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 2 });

  const ingested = await ingestEvidence(services, document(), 'quality.lead');
  assert.equal(ingested.duplicateOf, null);
  assert.equal(ingested.attachments[0]?.controlId, 'CONT-01');

  const after = await recomputeFramework(services, 'demo-msp');
  const policy = after.statuses.find((status) => status.controlId === 'CONT-01');
  const backup = after.statuses.find((status) => status.controlId === 'CONT-03');
  assert.equal(policy?.state, 'COVERED');
  assert.equal(backup?.state, 'NO_EVIDENCE');

  const reminders = await runReminders(services, 'demo-msp');
  assert.deepEqual(reminders.map((reminder) => reminder.controlId), ['CONT-03'], 'only the missing control is reminded');

  const pack = await assemblePack(services, 'demo-msp', 'quality.lead');
  assert.equal(pack.checksumsVerified, true);
  assert.equal(pack.index.length, 2);
  assert.deepEqual(pack.knownGaps.map((gap) => gap.controlId), ['CONT-03']);

  const answer = await askQuestion(services, principal({ role: 'QUALITY_LEAD', clearance: 'RESTRICTED' }), 'When was the policy reviewed?');
  assert.equal(answer.noEvidence, false);
  assert.equal(answer.citations[0]?.page, 1);

  const audit = services.events().map((event) => event.action);
  assert.deepEqual(audit, [
    'FRAMEWORK_IMPORTED',
    'STATE_RECOMPUTED',
    'STATE_RECOMPUTED',
    'EVIDENCE_COLLECTED',
    'EVIDENCE_READ',
    'ATTACHMENT_APPLIED',
    'STATE_RECOMPUTED',
    'STATE_RECOMPUTED',
    'STATE_RECOMPUTED',
    'REMINDER_SENT',
    'STATE_RECOMPUTED',
    'PACK_ASSEMBLED',
    'QUESTION_ASKED'
  ]);
});

test('the chain is idempotent on a duplicate deposit (R8)', async () => {
  const services = bundle();
  await importFramework(services, makeFrameworkImport(CONTROLS), 'quality.lead');
  const first = await ingestEvidence(services, document(), 'quality.lead');
  const second = await ingestEvidence(services, document({ uri: 's3://bucket/policy.pdf', kind: 'S3' }), 'collector.s3');

  assert.equal(second.duplicateOf, first.evidence.id);
  assert.equal((await services.state.listEvidence()).length, 1);
  assert.equal((await services.state.listAttachments()).length, 1, 'no second attachment');
  const statuses = await services.state.listStatuses('demo-msp');
  assert.equal(statuses.find((status) => status.controlId === 'CONT-01')?.state, 'COVERED');
});

test('a question the evidence does not answer says so (R12)', async () => {
  const services = bundle();
  await importFramework(services, makeFrameworkImport(CONTROLS), 'quality.lead');
  services.evidenceRetriever.search = async () => [];
  services.composer.compose = async () => ({ text: NO_EVIDENCE_ANSWER, citations: [] });

  const answer = await askQuestion(services, principal(), 'What is our carbon footprint?');
  assert.equal(answer.noEvidence, true);
  assert.equal(answer.text, NO_EVIDENCE_ANSWER);
});

test('a low-confidence document waits in the validation queue and is applied by a human', async () => {
  const services = fakeServices({
    read: { pages: [{ page: 1, text: POLICY_TEXT }] },
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.55, quote: QUOTE }],
    elements: [
      { expected: 'Policy title', present: true, quote: 'Information security policy version 3.1' },
      { expected: 'Review date', present: true, quote: 'reviewed on 1 August 2026' },
      { expected: 'Approver name', present: true, quote: 'approved by C. Bernard' },
      { expected: 'Version', present: true, quote: 'version 3.1' }
    ]
  });
  await importFramework(services, makeFrameworkImport([CONTROLS[0]!]), 'quality.lead');
  await ingestEvidence(services, document(), 'quality.lead');

  const queue = await listValidationQueue(services);
  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.kind, 'ATTACHMENT');

  const decided = await import('../../src/pipeline/validation.ts');
  const result = await decided.decideValidation(services, queue[0]!.id, { decision: 'ACCEPT', by: 'quality.lead' });
  assert.equal(result.item.status, 'DECIDED');
  assert.equal(result.statuses[0]?.state, 'COVERED', 'the human decision moved the control');
});
