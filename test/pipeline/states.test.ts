/**
 * States — EF-FRA-02/03/04, acceptance R5 ("politique datée de 18 mois,
 * périodicité annuelle : contrôle périmé") and R6 ("aucun test ce trimestre :
 * contrôle sans preuve").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeAfterIngest, recomputeFramework } from '../../src/pipeline/states.ts';
import { makeControl } from '../fixtures/builders.ts';
import { TEST_NOW, makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from './fakeServices.ts';

const POLICY = makeControl({ id: 'CONT-01', mandatory: false, periodicity: 'P1Y' });
const BACKUP = makeControl({ id: 'CONT-03', mandatory: false, periodicity: 'P3M' });

/** Stores one applied attachment with a complete sufficiency for a control. */
async function attachApplied(
  services: ReturnType<typeof fakeServices>,
  controlId: string,
  evidenceId: string,
  sufficiencyClass: 'COMPLETE' | 'PARTIAL' = 'COMPLETE'
): Promise<void> {
  const attachment = pendingAttachment({ id: `at-${evidenceId}`, status: 'APPLIED', controlId, evidenceId });
  await services.state.putAttachment(attachment);
  await services.state.putSufficiency(
    makeSufficiency({
      id: `sf-${evidenceId}`,
      attachmentId: attachment.id,
      evidenceId,
      controlId,
      class: sufficiencyClass,
      missing: sufficiencyClass === 'COMPLETE' ? [] : ['Recovery time']
    })
  );
}

test('R5: an evidence older than the periodicity leaves the control expired', async () => {
  const services = fakeServices();
  await seed(services, [POLICY]);
  await services.state.putEvidence(
    storedEvidence({ id: 'ev-old', fields: { ...storedEvidence().fields, documentDate: '2025-05-11' } })
  );
  await attachApplied(services, 'CONT-01', 'ev-old');

  const { statuses } = await recomputeFramework(services, 'demo-msp');

  assert.equal(statuses[0]?.state, 'EXPIRED');
  assert.equal(statuses[0]?.freshness, 'EXPIRED');
  assert.equal(statuses[0]?.expiresAt, '2026-05-11T00:00:00.000Z');
  assert.deepEqual(statuses[0]?.notes, ['applied-evidence-expired']);
});

test('R6: a control with no applied evidence is NO_EVIDENCE', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);

  const { statuses, readiness } = await recomputeFramework(services, 'demo-msp');

  assert.equal(statuses[0]?.state, 'NO_EVIDENCE');
  assert.equal(readiness.counts.NO_EVIDENCE, 1);
  assert.equal(readiness.shares.NO_EVIDENCE, 1);
});

test('a fresh, complete, non-mandatory control is COVERED', async () => {
  const services = fakeServices();
  await seed(services, [POLICY]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-new' }));
  await attachApplied(services, 'CONT-01', 'ev-new');

  const { statuses } = await recomputeFramework(services, 'demo-msp');
  assert.equal(statuses[0]?.state, 'COVERED');
  assert.deepEqual(statuses[0]?.notes, []);
});

test('a mandatory control needs one human validation per evidence type first (12.4)', async () => {
  const services = fakeServices();
  const mandatory = makeControl({ id: 'CONT-01', mandatory: true, periodicity: 'P1Y' });
  await seed(services, [mandatory]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-m' }));
  await attachApplied(services, 'CONT-01', 'ev-m');

  const first = await recomputeFramework(services, 'demo-msp');
  assert.equal(first.statuses[0]?.state, 'TO_VERIFY');
  assert.deepEqual(first.statuses[0]?.notes, ['mandatory-first-validation-required']);

  await services.state.markTypeValidated('CONT-01', 'POLICY', 'quality.lead');
  const second = await recomputeFramework(services, 'demo-msp');
  assert.equal(second.statuses[0]?.state, 'COVERED');
});

test('an evidence without a readable date cannot cover a control (12.4)', async () => {
  const services = fakeServices();
  await seed(services, [POLICY]);
  await services.state.putEvidence(
    storedEvidence({ id: 'ev-nodate', fields: { ...storedEvidence().fields, documentDate: null, approvalDate: null } })
  );
  await attachApplied(services, 'CONT-01', 'ev-nodate');

  const { statuses } = await recomputeFramework(services, 'demo-msp');
  assert.equal(statuses[0]?.state, 'TO_VERIFY');
  assert.deepEqual(statuses[0]?.notes, ['evidence-date-missing']);
});

test('a partial sufficiency keeps the control in TO_VERIFY', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-p' }));
  await attachApplied(services, 'CONT-03', 'ev-p', 'PARTIAL');

  const { statuses } = await recomputeFramework(services, 'demo-msp');
  assert.equal(statuses[0]?.state, 'TO_VERIFY');
  assert.equal(statuses[0]?.sufficiencyClass, 'PARTIAL');
});

test('the recomputation persists the states, appends one trend point and journals it', async () => {
  const services = fakeServices();
  await seed(services, [POLICY, BACKUP]);

  await recomputeFramework(services, 'demo-msp');
  await recomputeFramework(services, 'demo-msp');

  const stored = await services.state.listStatuses('demo-msp');
  assert.equal(stored.length, 2);
  const trend = await services.state.listTrend('demo-msp');
  assert.equal(trend.length, 1, 'reading twice does not fake a two-step history');
  assert.equal(trend[0]?.counts.NO_EVIDENCE, 2);
  assert.equal(services.events('STATE_RECOMPUTED').length, 2);
  assert.equal(services.events('STATE_RECOMPUTED')[0]?.detail.controls, 2);
});

test('recomputeAfterIngest targets only the frameworks the evidence is attached to', async () => {
  const services = fakeServices();
  await seed(services, [POLICY]);
  await services.state.putFramework({ ...(await services.state.getFramework('demo-msp'))!, id: 'other' });
  await services.state.putControls([makeControl({ id: 'CONT-77', frameworkId: 'other' })]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-x' }));
  await attachApplied(services, 'CONT-01', 'ev-x');

  const statuses = await recomputeAfterIngest(services, 'ev-x');

  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.frameworkId, 'demo-msp');
  assert.equal(await services.state.getStatus('CONT-77'), null, 'an unrelated framework is left alone');
});

test('an unknown framework recomputes to an empty snapshot', async () => {
  const services = fakeServices();
  const { statuses, readiness } = await recomputeFramework(services, 'missing');
  assert.deepEqual(statuses, []);
  assert.equal(readiness.total, 0);
  assert.equal(readiness.computedAt, TEST_NOW);
});
