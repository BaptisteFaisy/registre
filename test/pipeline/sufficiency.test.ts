/**
 * Sufficiency — EF-SUF-01/02, acceptance R7 ("compte rendu sans durée de
 * reprise : suffisance partielle, manque listé dans la relance").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAttachments } from '../../src/pipeline/sufficiency.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from './fakeServices.ts';

const CONTROL = makeControl({
  id: 'CONT-03',
  mandatory: false,
  expectedEvidence: ['Test date', 'Recovery time', 'Signatory'],
  periodicity: 'P3M'
});

test('R7: one missing element makes the sufficiency partial and lists the gap', async () => {
  const services = fakeServices({
    elements: [
      { expected: 'Test date', present: true, quote: 'ran on 14 October 2026' },
      { expected: 'Recovery time', present: false, quote: null },
      { expected: 'Signatory', present: true, quote: 'Signed by L. Moreau' }
    ]
  });
  await seed(services, [CONTROL]);
  const evidence = storedEvidence({ id: 'ev-1' });
  const attachment = pendingAttachment({ status: 'APPLIED', controlId: 'CONT-03' });

  const outcome = await assessAttachments(services, evidence, [attachment]);

  assert.equal(outcome.sufficiencies[0]?.class, 'PARTIAL');
  assert.deepEqual(outcome.sufficiencies[0]?.missing, ['Recovery time']);
  assert.equal(outcome.validationItems.length, 1);
  assert.equal(outcome.validationItems[0]?.kind, 'SUFFICIENCY');
  assert.match(outcome.validationItems[0]?.reason ?? '', /Recovery time/);
  const stored = await services.state.listValidations({ status: 'PENDING' });
  assert.equal(stored.length, 1, 'the item is persisted, not only returned');
});

test('every element present gives a complete sufficiency and no review', async () => {
  const services = fakeServices({
    elements: [
      { expected: 'Test date', present: true, quote: 'ran on 14 October 2026' },
      { expected: 'Recovery time', present: true, quote: 'took 42 minutes' },
      { expected: 'Signatory', present: true, quote: 'Signed by L. Moreau' }
    ]
  });
  await seed(services, [CONTROL]);
  const outcome = await assessAttachments(services, storedEvidence({ id: 'ev-2' }), [
    pendingAttachment({ status: 'APPLIED', controlId: 'CONT-03' })
  ]);

  assert.equal(outcome.sufficiencies[0]?.class, 'COMPLETE');
  assert.deepEqual(outcome.sufficiencies[0]?.missing, []);
  assert.deepEqual(outcome.validationItems, []);
});

test('an element declared present without a quote counts as missing', async () => {
  const services = fakeServices({
    elements: [
      { expected: 'Test date', present: true, quote: 'ran on 14 October 2026' },
      { expected: 'Recovery time', present: true, quote: null },
      { expected: 'Signatory', present: true, quote: 'Signed by L. Moreau' }
    ]
  });
  await seed(services, [CONTROL]);
  const outcome = await assessAttachments(services, storedEvidence({ id: 'ev-3' }), [
    pendingAttachment({ status: 'APPLIED', controlId: 'CONT-03' })
  ]);

  assert.equal(outcome.sufficiencies[0]?.class, 'PARTIAL');
  assert.deepEqual(outcome.sufficiencies[0]?.missing, ['Recovery time']);
});

test('a rejected attachment is never assessed', async () => {
  const services = fakeServices({ elements: [] });
  await seed(services, [CONTROL]);
  const outcome = await assessAttachments(services, storedEvidence({ id: 'ev-4' }), [
    pendingAttachment({ status: 'REJECTED', rejectionReason: 'CITATION_NOT_FOUND', controlId: 'CONT-03' })
  ]);

  assert.deepEqual(outcome.sufficiencies, []);
  assert.deepEqual(await services.state.listSufficiency(), []);
});

test('an unknown control is skipped rather than guessed', async () => {
  const services = fakeServices({ elements: [] });
  const outcome = await assessAttachments(services, storedEvidence({ id: 'ev-5' }), [
    pendingAttachment({ controlId: 'CONT-99' })
  ]);
  assert.deepEqual(outcome.sufficiencies, []);
});
