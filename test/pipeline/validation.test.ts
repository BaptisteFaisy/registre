/**
 * Validation queue and decisions — EF-VAL-01/02 ("chaque validation garde son
 * auteur, sa date et son motif") and the acceptance scenario of docs/API.md §10
 * (accept, reject, correct).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decideValidation, listValidationQueue } from '../../src/pipeline/validation.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, pendingItem, seed, storedEvidence } from './fakeServices.ts';

const CONTROL = makeControl({ id: 'CONT-01', mandatory: false });

/** Bundle holding one pending attachment and its queue item. */
async function pendingBundle() {
  const services = fakeServices();
  await seed(services, [CONTROL]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-1' }));
  await services.state.putAttachment(pendingAttachment({ id: 'at-test-1', status: 'PROPOSED' }));
  await services.state.putValidation(pendingItem({ id: 'va-test-1', attachmentId: 'at-test-1' }));
  return services;
}

test('the queue lists the pending items and never duplicates them (EF-VAL-01)', async () => {
  const services = await pendingBundle();
  const first = await listValidationQueue(services);
  const second = await listValidationQueue(services);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0]?.kind, 'ATTACHMENT');
});

test('the queue adds a partial sufficiency and an unreadable evidence', async () => {
  const services = fakeServices();
  await seed(services, [CONTROL]);
  await services.state.putEvidence(
    storedEvidence({ id: 'ev-blank', flags: { unreadable: true, missingDate: true, missingAuthor: true, dateToConfirm: false } })
  );
  await services.state.putSufficiency({
    id: 'sf-1',
    attachmentId: 'at-1',
    evidenceId: 'ev-1',
    controlId: 'CONT-01',
    elements: [],
    class: 'PARTIAL',
    missing: ['Recovery time'],
    computedAt: '2026-11-11T12:00:00.000Z'
  });

  const items = await listValidationQueue(services);

  assert.deepEqual(items.map((item) => item.kind).sort(), ['SUFFICIENCY', 'UNREADABLE_EVIDENCE']);
});

test('ACCEPT applies the attachment and keeps the author and the date', async () => {
  const services = await pendingBundle();
  const { item, statuses } = await decideValidation(services, 'va-test-1', {
    decision: 'ACCEPT',
    by: 'quality.lead',
    note: 'correct control, quote matches page 1'
  });

  assert.equal(item.status, 'DECIDED');
  assert.equal(item.decision, 'ACCEPT');
  assert.equal(item.decidedBy, 'quality.lead');
  assert.equal(item.decidedAt, '2026-11-11T12:00:00.000Z');
  assert.equal(item.note, 'correct control, quote matches page 1');

  const attachment = await services.state.getAttachment('at-test-1');
  assert.equal(attachment?.status, 'APPLIED');
  assert.equal(attachment?.autoApplied, false, 'a human applied it, not the threshold');
  assert.equal(attachment?.decidedBy, 'quality.lead');
  assert.equal(services.events('VALIDATION_DECIDED')[0]?.actor, 'quality.lead');
  assert.equal(statuses.length, 1, 'the affected control is recomputed');
});

test('REJECT refuses the attachment with the HUMAN_REJECTED reason', async () => {
  const services = await pendingBundle();
  await decideValidation(services, 'va-test-1', { decision: 'REJECT', by: 'quality.lead' });

  const attachment = await services.state.getAttachment('at-test-1');
  assert.equal(attachment?.status, 'REJECTED');
  assert.equal(attachment?.rejectionReason, 'HUMAN_REJECTED');
  assert.equal(attachment?.decidedBy, 'quality.lead');
});

test('CORRECT requires a note explaining what was corrected', async () => {
  const services = await pendingBundle();
  await assert.rejects(
    () => decideValidation(services, 'va-test-1', { decision: 'CORRECT', by: 'quality.lead' }),
    { code: 'BAD_REQUEST' }
  );
  assert.equal((await services.state.getValidation('va-test-1'))?.status, 'PENDING');
});

test('CORRECT applies the attachment and records the correction', async () => {
  const services = await pendingBundle();
  const { item } = await decideValidation(services, 'va-test-1', {
    decision: 'CORRECT',
    by: 'quality.lead',
    note: 'the quote is on page 2, not page 1'
  });

  assert.equal(item.decision, 'CORRECT');
  assert.equal(item.note, 'the quote is on page 2, not page 1');
  const attachment = await services.state.getAttachment('at-test-1');
  assert.equal(attachment?.status, 'APPLIED');
  assert.equal(attachment?.decidedNote, 'the quote is on page 2, not page 1');
});

test('a second decision on the same item is refused as a conflict', async () => {
  const services = await pendingBundle();
  await decideValidation(services, 'va-test-1', { decision: 'ACCEPT', by: 'quality.lead' });
  await assert.rejects(
    () => decideValidation(services, 'va-test-1', { decision: 'REJECT', by: 'quality.lead' }),
    { code: 'CONFLICT' }
  );
});

test('an unknown item is a NOT_FOUND', async () => {
  const services = await pendingBundle();
  await assert.rejects(
    () => decideValidation(services, 'va-unknown', { decision: 'ACCEPT', by: 'quality.lead' }),
    { code: 'NOT_FOUND' }
  );
});

test('accepting an attachment validates the evidence type for the control (EF-SUF-03)', async () => {
  const services = await pendingBundle();
  assert.equal(await services.state.isTypeValidated('CONT-01', 'POLICY'), false);
  await decideValidation(services, 'va-test-1', { decision: 'ACCEPT', by: 'quality.lead' });
  assert.equal(await services.state.isTypeValidated('CONT-01', 'POLICY'), true);
});
