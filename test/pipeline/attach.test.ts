/**
 * Attachment — EF-RAT-01..05, acceptance R3 (confident attachment applied),
 * R4 (a quote absent from the document cancels the attachment), R9 (a mis-filed
 * evidence is attached to the right control) and R10 (an unrelated evidence is
 * attached to nothing).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeAttachments } from '../../src/pipeline/attach.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, seed, storedEvidence } from './fakeServices.ts';

const POLICY_TEXT =
  'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';
const BACKUP_TEXT =
  'Quarterly backup restore test ran on 14 October 2026 and took 42 minutes. Signed by L. Moreau.';

const POLICY = makeControl({ id: 'CONT-01', mandatory: false });
const BACKUP = makeControl({
  id: 'CONT-03',
  title: 'Backups are tested by a real restore',
  requirement: 'A backup restore is performed and recorded every quarter.',
  expectedEvidence: ['Test date', 'Recovery time'],
  periodicity: 'P3M'
});

test('R3: a confident attachment whose quote is in the document is applied', async () => {
  const services = fakeServices({
    controls: [POLICY],
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.93, quote: 'reviewed on 1 August 2026' }]
  });
  await seed(services, [POLICY]);
  const evidence = storedEvidence({ id: 'ev-a', textPages: [{ page: 1, text: POLICY_TEXT }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');

  assert.equal(outcome.attachments.length, 1);
  assert.equal(outcome.attachments[0]?.status, 'APPLIED');
  assert.equal(outcome.attachments[0]?.autoApplied, true);
  assert.deepEqual(outcome.validationItems, []);
  assert.equal(services.events('ATTACHMENT_APPLIED').length, 1);
});

test('R4: a hallucinated quote rejects the attachment and never applies it', async () => {
  const services = fakeServices({
    controls: [POLICY],
    proposals: [
      {
        controlId: 'CONT-01',
        supports: true,
        confidence: 0.98,
        quote: 'The policy was audited by an external firm in December 2025.'
      }
    ]
  });
  await seed(services, [POLICY]);
  const evidence = storedEvidence({ id: 'ev-b', textPages: [{ page: 1, text: POLICY_TEXT }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');
  const attachment = outcome.attachments[0];

  assert.equal(attachment?.status, 'REJECTED');
  assert.equal(attachment?.rejectionReason, 'CITATION_NOT_FOUND');
  assert.equal(attachment?.citationVerified, false);
  assert.equal(attachment?.quoteLocation.page, null);
  assert.equal(outcome.validationItems.length, 0, 'a cancelled attachment needs no review');
  assert.equal(services.events('ATTACHMENT_REJECTED')[0]?.detail.reason, 'CITATION_NOT_FOUND');
  assert.equal((await services.state.listAttachments({ status: 'APPLIED' })).length, 0);
});

test('a confidence below the threshold proposes the attachment and queues it', async () => {
  const services = fakeServices({
    controls: [POLICY],
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.62, quote: 'reviewed on 1 August 2026' }]
  });
  await seed(services, [POLICY]);
  const evidence = storedEvidence({ id: 'ev-c', textPages: [{ page: 1, text: POLICY_TEXT }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');

  assert.equal(outcome.attachments[0]?.status, 'PROPOSED');
  assert.equal(outcome.attachments[0]?.autoApplied, false);
  assert.equal(outcome.validationItems.length, 1);
  assert.equal(outcome.validationItems[0]?.kind, 'ATTACHMENT');
  assert.match(outcome.validationItems[0]?.reason ?? '', /0\.62 below threshold 0\.85/);
  assert.equal(services.events('ATTACHMENT_PROPOSED').length, 1);
});

test('R9: a mis-filed document is attached to the control it actually supports', async () => {
  const services = fakeServices({
    controls: [POLICY, BACKUP],
    proposals: [
      { controlId: 'CONT-01', supports: false, confidence: 0.2, quote: '' },
      { controlId: 'CONT-03', supports: true, confidence: 0.91, quote: 'took 42 minutes' }
    ]
  });
  await seed(services, [POLICY, BACKUP]);
  const evidence = storedEvidence({
    id: 'ev-d',
    fields: { ...storedEvidence().fields, type: 'REPORT', title: 'Backup restore test' },
    textPages: [{ page: 2, text: BACKUP_TEXT }]
  });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');

  assert.equal(outcome.attachments.length, 1);
  assert.equal(outcome.attachments[0]?.controlId, 'CONT-03');
  assert.equal(outcome.attachments[0]?.status, 'APPLIED');
  assert.equal(outcome.attachments[0]?.quoteLocation.page, 2, 'the real page of the document');
});

test('R10: an evidence that supports no control is attached to nothing', async () => {
  const services = fakeServices({
    controls: [POLICY],
    proposals: [{ controlId: 'CONT-01', supports: false, confidence: 0.3, quote: '' }]
  });
  await seed(services, [POLICY]);
  const evidence = storedEvidence({ id: 'ev-e', textPages: [{ page: 1, text: 'Company Christmas lunch menu.' }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');

  assert.deepEqual(outcome.attachments, []);
  assert.deepEqual(await services.state.listAttachments(), []);
});

test('no candidate control means no model call and no attachment', async () => {
  const services = fakeServices({ controls: [], proposals: [] });
  const evidence = storedEvidence({ id: 'ev-f', textPages: [{ page: 1, text: POLICY_TEXT }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline');

  assert.equal(outcome.candidateCount, 0);
  assert.deepEqual(outcome.attachments, []);
});

test('the control named at deposit time is always among the candidates', async () => {
  const services = fakeServices({ controls: [POLICY, BACKUP], proposals: [] });
  await seed(services, [POLICY, BACKUP]);
  const evidence = storedEvidence({ id: 'ev-g', textPages: [{ page: 1, text: POLICY_TEXT }] });

  const outcome = await proposeAttachments(services, evidence, 'pipeline', { suggestedControlId: 'CONT-03' });

  assert.equal(outcome.candidateCount, 2, 'CONT-03 is a candidate even though it comes from the hint');
});
