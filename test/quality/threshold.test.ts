/**
 * Automatic degradation — the measured quality drives the attachment
 * threshold (bonus axis, spec 13.5): a failing measurement pushes the
 * threshold above 1 so nothing is auto-applied any more, and a passing
 * measurement restores the configured setting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentThreshold, buildQualityRecord, recordEvaluation } from '../../src/pipeline/quality.ts';
import type { EvaluationInput, QualityMeasurement } from '../../src/pipeline/quality.ts';
import { proposeAttachments } from '../../src/pipeline/attach.ts';
import type { QualitySubject } from '../../src/domain/quality.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { ATTACHMENT_PROMPT_VERSION } from '../../src/ai/versioning.ts';
import { createScriptedReasoner } from '../../src/ai/mock/scriptedReasoner.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, seed, storedEvidence } from '../pipeline/fakeServices.ts';
import type { FakeBundle } from '../pipeline/fakeServices.ts';

const POLICY_TEXT = 'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';
const QUOTE = 'reviewed on 1 August 2026';

const POLICY = makeControl({ id: 'CONT-01', mandatory: false });

const SUBJECT: QualitySubject = {
  kind: 'ATTACHMENT',
  modelId: 'test-model',
  promptVersion: ATTACHMENT_PROMPT_VERSION
};

/** One ACCEPTED_WITHOUT_CORRECTION measurement, ratio against its target. */
function acceptance(value: number, target = 0.85): QualityMeasurement {
  return { metric: 'ACCEPTED_WITHOUT_CORRECTION', value, target, sampleCount: 60, datasetVersion: 'ds-test' };
}

function evaluation(value: number, target = 0.85): EvaluationInput {
  return { subject: SUBJECT, records: [acceptance(value, target)] };
}

function attachServices(): FakeBundle {
  return fakeServices({
    controls: [POLICY],
    proposals: [{ controlId: 'CONT-01', supports: true, confidence: 0.95, quote: QUOTE }]
  });
}

test('without a measurement the configured threshold applies', async () => {
  const services = attachServices();
  assert.equal(await attachmentThreshold(services), services.settings.confidenceThreshold);
});

test('a failing measurement forces the threshold above 1 and routes a 0.95 attachment to humans', async () => {
  const services = attachServices();
  await seed(services, [POLICY]);
  const recorded = await recordEvaluation(services, evaluation(0.6));

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.verdict, 'FAIL');
  const threshold = await attachmentThreshold(services);
  assert.ok(threshold > 1, `threshold ${threshold} must be unreachable`);

  const outcome = await proposeAttachments(services, storedEvidence({ id: 'ev-q1', textPages: [{ page: 1, text: POLICY_TEXT }] }), 'pipeline');
  assert.equal(outcome.attachments[0]?.status, 'PROPOSED');
  assert.equal(outcome.attachments[0]?.autoApplied, false);
  assert.equal(outcome.attachments[0]?.confidence, 0.95);
  assert.equal(outcome.validationItems.length, 1, 'everything goes to the validation queue');
});

test('a passing measurement restores the configured threshold', async () => {
  const services = attachServices();
  await seed(services, [POLICY]);
  await recordEvaluation(services, evaluation(0.6));
  assert.ok((await attachmentThreshold(services)) > 1);

  (services.clock as FixedClock).set('2026-11-12T09:00:00.000Z');
  const restored = await recordEvaluation(services, evaluation(0.9));
  assert.equal(restored[0]?.verdict, 'PASS');
  assert.equal(await attachmentThreshold(services), services.settings.confidenceThreshold);

  const outcome = await proposeAttachments(services, storedEvidence({ id: 'ev-q2', textPages: [{ page: 1, text: POLICY_TEXT }] }), 'pipeline');
  assert.equal(outcome.attachments[0]?.status, 'APPLIED');
  assert.equal(outcome.attachments[0]?.autoApplied, true);
});

test('recordEvaluation journalls every measurement and computes deterministic ids', async () => {
  const services = fakeServices({});
  const first = await recordEvaluation(services, evaluation(0.9));
  assert.equal(services.events('QUALITY_RECORDED').length, 1);
  const event = services.events('QUALITY_RECORDED')[0];
  assert.equal(event?.detail.metric, 'ACCEPTED_WITHOUT_CORRECTION');
  assert.equal(event?.detail.verdict, 'PASS');

  // Same subject, metric and instant: the id is derived, not random.
  const again = buildQualityRecord(SUBJECT, acceptance(0.9), first[0]!.measuredAt);
  assert.equal(again.id, first[0]?.id);
  assert.match(first[0]!.id, /^qr-[0-9a-f]{12}$/);

  const persisted = await services.extensions.listQuality();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.id, first[0]?.id);
});

test('a zero-target metric passes only at exactly zero', () => {
  const zero = buildQualityRecord(SUBJECT, { metric: 'WRONG_HIGH_CONFIDENCE', value: 0, target: 0, sampleCount: 60, datasetVersion: 'ds-test' }, '2026-11-11T12:00:00.000Z');
  const one = buildQualityRecord(SUBJECT, { metric: 'WRONG_HIGH_CONFIDENCE', value: 1, target: 0, sampleCount: 60, datasetVersion: 'ds-test' }, '2026-11-11T12:00:00.000Z');
  assert.equal(zero.verdict, 'PASS');
  assert.equal(one.verdict, 'FAIL');
});

test('promptVersion rides from the mock reasoner to the persisted attachment', async () => {
  const services = fakeServices({ controls: [POLICY] });
  services.reasoner = createScriptedReasoner({
    attachments: new Map([
      ['ev-q3', [{ controlId: 'CONT-01', supports: true, confidence: 0.95, quote: QUOTE, page: 1, reason: 'scripted' }]]
    ])
  });
  await seed(services, [POLICY]);

  const outcome = await proposeAttachments(services, storedEvidence({ id: 'ev-q3', textPages: [{ page: 1, text: POLICY_TEXT }] }), 'pipeline');
  assert.equal(outcome.attachments[0]?.promptVersion, ATTACHMENT_PROMPT_VERSION);

  const persisted = await services.state.listAttachments({});
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.promptVersion, ATTACHMENT_PROMPT_VERSION);
});
