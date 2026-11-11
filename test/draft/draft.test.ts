/**
 * Pre-filled drafts (axis 3b) — the guard rail matters more than the feature:
 * a draft is never evidence, never stored in the vault, never attached.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRY_MIN_SCORE, MAX_CARRIED_CHARS, generateDraft, previousVersion } from '../../src/pipeline/draft.ts';
import { DRAFT_WATERMARK } from '../../src/domain/draft.ts';
import { makeControl, makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from '../pipeline/fakeServices.ts';

const PROCEDURE = makeControl({
  id: 'CONT-11',
  title: 'Changes approved before implementation',
  requirement: 'Every change to a production environment is approved before it is implemented.',
  expectedEvidence: ['Change identifier', 'Authoriser name', 'Implementation date', 'Rollback plan']
});

const PREVIOUS_TEXT = [
  'Change procedure, version 3.0.',
  'Change identifier: each change carries the identifier CHG-2026-0142 in the register.',
  'Authoriser name: the change advisory board chair approves before implementation.',
  'Implementation date: the change was implemented on 2026-09-14 at 22:00.',
  'Rollback plan: the previous release is kept for 48 hours and restored on failure.'
].join('\n');

/** One control with a previous, applied version to carry over from. */
async function withPrevious() {
  const services = fakeServices({ now: '2026-11-11T09:00:00.000Z' });
  await seed(services, [PROCEDURE]);
  await services.state.putEvidence(
    storedEvidence({
      id: 'ev-previous',
      sha256: 'd'.repeat(64),
      textPages: [{ page: 1, text: PREVIOUS_TEXT }]
    })
  );
  await services.state.putAttachment(
    pendingAttachment({ id: 'at-previous', status: 'APPLIED', controlId: PROCEDURE.id, evidenceId: 'ev-previous' })
  );
  await services.state.putSufficiency(
    makeSufficiency({
      id: 'sf-previous',
      attachmentId: 'at-previous',
      evidenceId: 'ev-previous',
      controlId: PROCEDURE.id,
      class: 'COMPLETE'
    })
  );
  return services;
}

test('every expected element becomes a section', async () => {
  const services = await withPrevious();
  const draft = await generateDraft(services, PROCEDURE.id, 'quality.lead');
  assert.equal(draft.sections.length, PROCEDURE.expectedEvidence.length);
  for (const section of draft.sections) {
    assert.ok(PROCEDURE.expectedEvidence.includes(section.expected));
  }
  assert.equal(draft.controlId, PROCEDURE.id);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.format, 'MARKDOWN');
});

test('the draft is watermarked and can never be attached', async () => {
  const services = await withPrevious();
  const draft = await generateDraft(services, PROCEDURE.id, 'quality.lead');
  assert.equal(draft.watermark, DRAFT_WATERMARK);
  assert.equal(draft.attachable, false);
  assert.match(draft.content, /DRAFT/);
  assert.match(draft.content, /Signature/);
});

test('the previous version is carried over and named', async () => {
  const services = await withPrevious();
  const draft = await generateDraft(services, PROCEDURE.id, 'quality.lead');
  assert.deepEqual(draft.basedOn, ['ev-previous']);
  const carried = draft.sections.filter((section) => !section.toComplete);
  assert.ok(carried.length >= 1, 'at least one element is carried over');
  for (const section of carried) {
    assert.ok(section.body.length <= MAX_CARRIED_CHARS);
    assert.ok(section.body.length > 0);
  }
});

test('what cannot be carried over stays an explicit placeholder', async () => {
  const services = fakeServices({ now: '2026-11-11T09:00:00.000Z' });
  await seed(services, [PROCEDURE]);
  const draft = await generateDraft(services, PROCEDURE.id, 'quality.lead');
  assert.equal(draft.basedOn.length, 0);
  assert.equal(draft.sections.every((section) => section.toComplete), true);
  assert.deepEqual(draft.missing, PROCEDURE.expectedEvidence);
  assert.match(draft.content, /To complete/);
});

test('a draft writes nothing: no vault object, no evidence, no attachment', async () => {
  const services = await withPrevious();
  const before = services.vaultKeys().length;
  const evidenceBefore = (await services.state.listEvidence()).length;
  const attachmentsBefore = (await services.state.listAttachments({})).length;

  await generateDraft(services, PROCEDURE.id, 'quality.lead');

  assert.equal(services.vaultKeys().length, before, 'the vault must stay untouched');
  assert.equal((await services.state.listEvidence()).length, evidenceBefore);
  assert.equal((await services.state.listAttachments({})).length, attachmentsBefore);
  assert.equal(services.events('DRAFT_GENERATED').length, 1, 'but the generation is journalled');
});

test('personal data is masked before it is carried over', async () => {
  const services = fakeServices({ now: '2026-11-11T09:00:00.000Z' });
  await seed(services, [PROCEDURE]);
  await services.state.putEvidence(
    storedEvidence({
      id: 'ev-pii',
      sha256: 'e'.repeat(64),
      textPages: [
        {
          page: 1,
          text:
            'Authoriser name: approved by claire.martin@northwind-msp.example on behalf of the board, phone +33 6 12 34 56 78.'
        }
      ]
    })
  );
  await services.state.putAttachment(
    pendingAttachment({ id: 'at-pii', status: 'APPLIED', controlId: PROCEDURE.id, evidenceId: 'ev-pii' })
  );
  const draft = await generateDraft(services, PROCEDURE.id, 'quality.lead');
  const carried = draft.sections.map((section) => section.body).join(' ');
  assert.ok(!carried.includes('claire.martin@northwind-msp.example'), 'an e-mail was carried over in clear');
  assert.ok(!carried.includes('+33 6 12 34 56 78'), 'a phone number was carried over in clear');
});

test('an unknown control is refused', async () => {
  const services = await withPrevious();
  await assert.rejects(() => generateDraft(services, 'CONT-99', 'quality.lead'), /does not exist/);
});

test('the most recent applied version is the one carried over', async () => {
  const services = await withPrevious();
  await services.state.putEvidence(
    storedEvidence({
      id: 'ev-newer',
      sha256: 'f'.repeat(64),
      textPages: [{ page: 1, text: 'Change identifier: CHG-2026-0999 supersedes the previous procedure.' }],
      fields: {
        ...storedEvidence().fields,
        documentDate: '2026-10-20'
      }
    })
  );
  await services.state.putAttachment(
    pendingAttachment({ id: 'at-newer', status: 'APPLIED', controlId: PROCEDURE.id, evidenceId: 'ev-newer' })
  );
  const previous = await previousVersion(services, PROCEDURE.id);
  assert.equal(previous?.id, 'ev-newer');
  assert.ok(CARRY_MIN_SCORE > 0 && CARRY_MIN_SCORE < 1);
});
