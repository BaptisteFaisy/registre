/**
 * Cross-framework mappings (axis 2) — one evidence serves every framework, and
 * nothing is ever applied without a human decision (EF-REF-04).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS, findControl } from '../../eval/catalogue.ts';
import { ISO_CONTROLS, ISO_FRAMEWORK, findIsoControl, toIsoFrameworkImport } from '../../eval/catalogue-iso.ts';
import {
  MAPPING_MIN_SCORE,
  PROPAGATION_MODEL,
  controlSimilarity,
  decideMapping,
  propagateAttachment,
  proposeMappings,
  requirementQuote,
  reuseMetric
} from '../../src/pipeline/crossmap.ts';
import type { Attachment, Control, Framework } from '../../src/domain/types.ts';
import { makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from '../pipeline/fakeServices.ts';

const MSP_IDS = ['CONT-01', 'CONT-03', 'CONT-16'];
const ISO_IDS = ['ISO-01', 'ISO-02', 'ISO-06'];

/** Catalogue controls are framework-agnostic; the store needs the framework id. */
function asControl(source: { id: string; domain: string; title: string; requirement: string; expectedEvidence: readonly string[]; periodicity: string; owner: string; mandatory: boolean }, frameworkId: string): Control {
  return {
    id: source.id,
    frameworkId,
    domain: source.domain,
    title: source.title,
    requirement: source.requirement,
    expectedEvidence: [...source.expectedEvidence],
    periodicity: source.periodicity,
    owner: source.owner,
    mandatory: source.mandatory
  };
}

function mspControls(): Control[] {
  return MSP_IDS.map((id) => findControl(id))
    .filter((control): control is NonNullable<typeof control> => control !== undefined)
    .map((control) => asControl(control, 'demo-msp'));
}

function isoControls(): Control[] {
  return ISO_IDS.map((id) => findIsoControl(id))
    .filter((control): control is NonNullable<typeof control> => control !== undefined)
    .map((control) => asControl(control, ISO_FRAMEWORK.id));
}

/** Two frameworks in one store: `demo-msp` and `demo-iso`. */
async function twoFrameworks() {
  const services = fakeServices();
  await seed(services, mspControls(), { id: 'demo-msp' });
  const iso: Framework = {
    id: ISO_FRAMEWORK.id,
    name: ISO_FRAMEWORK.name,
    version: ISO_FRAMEWORK.version,
    importedAt: services.clock.now(),
    confidentiality: 'INTERNAL'
  };
  await services.state.putFramework(iso);
  await services.state.putControls(isoControls());
  return services;
}

test('the second demonstration framework is coherent', () => {
  assert.equal(ISO_CONTROLS.length, 12);
  assert.equal(new Set(ISO_CONTROLS.map((c) => c.domain)).size, 4);
  assert.equal(new Set(ISO_CONTROLS.map((c) => c.id)).size, 12);
  const mspIds = new Set(CONTROLS.map((c) => c.id));
  for (const control of ISO_CONTROLS) {
    for (const equivalent of control.equivalents) {
      assert.ok(mspIds.has(equivalent), `${control.id} references unknown ${equivalent}`);
    }
  }
  assert.equal(toIsoFrameworkImport().controls.length, 12);
});

test('proposals are created with both quotes verified by code', async () => {
  const services = await twoFrameworks();
  const proposed = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  assert.ok(proposed.length >= 2, `expected proposals, got ${proposed.length}`);
  for (const mapping of proposed) {
    assert.equal(mapping.status, 'PROPOSED');
    assert.equal(mapping.citationVerified, true);
    assert.ok(mapping.confidence >= MAPPING_MIN_SCORE);
    assert.ok(mapping.sourceQuote.length > 0);
    assert.ok(mapping.targetQuote.length > 0);
    assert.equal(mapping.sourceFrameworkId, 'demo-msp');
    assert.equal(mapping.targetFrameworkId, ISO_FRAMEWORK.id);
  }
  assert.equal(services.events('MAPPING_PROPOSED').length, 1);
});

test('proposing twice is idempotent and never overwrites a decision', async () => {
  const services = await twoFrameworks();
  const first = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  const again = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  assert.equal(again.length, 0, 'a second run must not duplicate a proposal');
  const all = await services.extensions.listMappings({});
  assert.equal(all.length, first.length);

  await decideMapping(services, first[0]!.id, { decision: 'VALIDATE', by: 'quality.lead' });
  await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  const after = await services.extensions.getMapping(first[0]!.id);
  assert.equal(after?.status, 'VALIDATED', 'a human decision is never overwritten');
});

test('a framework cannot be mapped to itself', async () => {
  const services = await twoFrameworks();
  await assert.rejects(
    () =>
      proposeMappings(services, {
        sourceFrameworkId: 'demo-msp',
        targetFrameworkId: 'demo-msp',
        actor: 'quality.lead'
      }),
    /cannot be mapped to itself/
  );
});

test('a decision keeps its author, its instant and its reason', async () => {
  const services = await twoFrameworks();
  const [mapping] = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  const validated = await decideMapping(services, mapping!.id, {
    decision: 'VALIDATE',
    by: 'camille.roy',
    note: 'same requirement in substance'
  });
  assert.equal(validated.status, 'VALIDATED');
  assert.equal(validated.validatedBy, 'camille.roy');
  assert.equal(validated.validatedAt, services.clock.now());
  assert.equal(validated.note, 'same requirement in substance');

  const rejected = await decideMapping(services, mapping!.id, { decision: 'REJECT', by: 'admin' });
  assert.equal(rejected.status, 'REJECTED');
  await assert.rejects(() => decideMapping(services, 'mp-nope', { decision: 'VALIDATE', by: 'x' }), /does not exist/);
});

test('a validated mapping only ever proposes on the other framework', async () => {
  const services = await twoFrameworks();
  const [mapping] = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  await decideMapping(services, mapping!.id, { decision: 'VALIDATE', by: 'quality.lead' });

  const evidence = storedEvidence({ id: 'ev-1', sha256: 'b'.repeat(64) });
  await services.state.putEvidence(evidence);
  const attachment: Attachment = pendingAttachment({
    id: 'at-1',
    status: 'APPLIED',
    frameworkId: 'demo-msp',
    controlId: mapping!.sourceControlId,
    evidenceId: 'ev-1',
    quote: 'Information security policy reviewed on 1 August 2026.'
  });
  await services.state.putAttachment(attachment);
  await services.state.putSufficiency(
    makeSufficiency({ id: 'sf-1', attachmentId: 'at-1', evidenceId: 'ev-1', controlId: mapping!.sourceControlId })
  );

  const used = await propagateAttachment(services, attachment);
  assert.deepEqual(used, [mapping!.id]);
  const carried = await services.state.listAttachments({ controlId: mapping!.targetControlId });
  assert.equal(carried.length, 1);
  assert.equal(carried[0]?.status, 'PROPOSED', 'a mapping never applies an attachment by itself');
  assert.equal(carried[0]?.autoApplied, false);
  assert.equal(carried[0]?.model, PROPAGATION_MODEL);
  assert.equal(carried[0]?.frameworkId, ISO_FRAMEWORK.id);

  // Propagating twice does not duplicate.
  await propagateAttachment(services, attachment);
  assert.equal((await services.state.listAttachments({ controlId: mapping!.targetControlId })).length, 1);
});

test('a rejected mapping propagates nothing, and a proposed one neither', async () => {
  const services = await twoFrameworks();
  const [mapping] = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  const evidence = storedEvidence({ id: 'ev-1' });
  await services.state.putEvidence(evidence);
  const attachment = pendingAttachment({
    id: 'at-1',
    status: 'APPLIED',
    frameworkId: 'demo-msp',
    controlId: mapping!.sourceControlId,
    evidenceId: 'ev-1'
  });
  await services.state.putAttachment(attachment);
  assert.deepEqual(await propagateAttachment(services, attachment), [], 'still PROPOSED: nothing to carry');

  await decideMapping(services, mapping!.id, { decision: 'REJECT', by: 'quality.lead' });
  assert.deepEqual(await propagateAttachment(services, attachment), []);
});

test('an attachment whose quote is not in the evidence is not carried', async () => {
  const services = await twoFrameworks();
  const [mapping] = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  await decideMapping(services, mapping!.id, { decision: 'VALIDATE', by: 'quality.lead' });
  await services.state.putEvidence(storedEvidence({ id: 'ev-1' }));
  const attachment = pendingAttachment({
    id: 'at-1',
    status: 'APPLIED',
    frameworkId: 'demo-msp',
    controlId: mapping!.sourceControlId,
    evidenceId: 'ev-1',
    quote: 'a sentence that appears nowhere in the stored document'
  });
  await services.state.putAttachment(attachment);
  assert.deepEqual(await propagateAttachment(services, attachment), []);
});

test('the reuse metric counts what one deposit is worth', async () => {
  const services = await twoFrameworks();
  const before = await reuseMetric(services, 'demo-msp');
  assert.equal(before.evidenceCount, 0);
  assert.equal(before.reuseFactor, 0);
  assert.equal(before.validatedMappings, 0);

  const proposed = await proposeMappings(services, {
    sourceFrameworkId: 'demo-msp',
    targetFrameworkId: ISO_FRAMEWORK.id,
    actor: 'quality.lead'
  });
  await decideMapping(services, proposed[0]!.id, { decision: 'VALIDATE', by: 'quality.lead' });
  const middle = await reuseMetric(services, 'demo-msp');
  assert.equal(middle.validatedMappings, 1);
  assert.equal(middle.pendingMappings, proposed.length - 1);

  await services.state.putEvidence(storedEvidence({ id: 'ev-1' }));
  await services.state.putAttachment(
    pendingAttachment({ id: 'at-1', status: 'APPLIED', controlId: proposed[0]!.sourceControlId, evidenceId: 'ev-1' })
  );
  await services.state.putAttachment(
    pendingAttachment({
      id: 'at-2',
      status: 'APPLIED',
      controlId: proposed[0]!.sourceControlId,
      evidenceId: 'ev-1',
      model: PROPAGATION_MODEL
    })
  );
  const after = await reuseMetric(services, 'demo-msp');
  assert.equal(after.evidenceCount, 1);
  assert.equal(after.attachmentCount, 2);
  assert.equal(after.carriedAttachments, 1);
  assert.equal(after.avoidedDeposits, 1);
  // One deposit serving three control links: the two applied attachments plus
  // the one a mapping carried over.
  assert.equal(after.reuseFactor, 3);
});

test('similarity and quoting helpers behave', () => {
  const policy = asControl(findControl('CONT-01')!, 'demo-msp');
  const isoControl = asControl(findIsoControl('ISO-01')!, ISO_FRAMEWORK.id);
  assert.ok(controlSimilarity(policy, isoControl) >= MAPPING_MIN_SCORE);
  assert.ok(controlSimilarity(policy, policy) > 0.9);
  const quote = requirementQuote(policy.requirement);
  assert.ok(quote.length > 20);
  assert.ok(policy.requirement.includes(quote.slice(0, 20)));
});
