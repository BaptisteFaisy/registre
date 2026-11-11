/**
 * Reminders and the weekly digest — EF-REL-01 ("relancer 30 jours avant la
 * péremption, en disant quelle preuve fournir"), EF-REL-02 ("relancer pour un
 * contrôle sans preuve"), EF-REL-03 (weekly point) and acceptance R6 ("aucun
 * test de restauration ce trimestre : contrôle sans preuve, relance envoyée").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runReminders, weeklyDigest } from '../../src/pipeline/reminders.ts';
import { makeControl, makeSufficiency } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, pendingItem, seed, storedEvidence } from './fakeServices.ts';

const POLICY = makeControl({ id: 'CONT-01', owner: 'quality.lead', mandatory: false, periodicity: 'P1Y' });
const BACKUP = makeControl({
  id: 'CONT-03',
  owner: 'ops.lead',
  mandatory: false,
  periodicity: 'P3M',
  expectedEvidence: ['Test date', 'Recovery time']
});

test('R6: a control with no evidence raises a NO_EVIDENCE reminder', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);

  const reminders = await runReminders(services, 'demo-msp');

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.reason, 'NO_EVIDENCE');
  assert.equal(reminders[0]?.controlId, 'CONT-03');
  assert.equal(reminders[0]?.recipient, 'ops.lead');
  assert.match(reminders[0]?.id ?? '', /^rm-[0-9a-f]{12}$/);
  assert.equal(services.sent().length, 1, 'the notifier is called, not reimplemented');
  assert.equal(services.sent()[0]?.kind, 'REMINDER');
  assert.match(services.sent()[0]?.body ?? '', /Recovery time/, 'the body lists what to provide');
  assert.equal(services.events('REMINDER_SENT').length, 1);
  assert.equal((await services.state.listReminders()).length, 1, 'the reminder is persisted');
});

test('the same control is reminded once per day, not once per run (EF-REL-01)', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);

  const first = await runReminders(services, 'demo-msp');
  const second = await runReminders(services, 'demo-msp');

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(services.sent().length, 1);
});

test('an evidence expiring inside the lead time raises EXPIRING_SOON', async () => {
  const services = fakeServices({ now: '2026-11-11T12:00:00.000Z' });
  await seed(services, [POLICY]);
  await services.state.putEvidence(
    storedEvidence({ id: 'ev-p', fields: { ...storedEvidence().fields, documentDate: '2025-12-01' } })
  );
  const attachment = pendingAttachment({ id: 'at-p', status: 'APPLIED', controlId: 'CONT-01', evidenceId: 'ev-p' });
  await services.state.putAttachment(attachment);
  await services.state.putSufficiency(
    makeSufficiency({ id: 'sf-p', attachmentId: 'at-p', evidenceId: 'ev-p', controlId: 'CONT-01' })
  );

  const reminders = await runReminders(services, 'demo-msp');
  const expiring = reminders.filter((reminder) => reminder.reason === 'EXPIRING_SOON');

  assert.equal(expiring.length, 1);
  assert.equal(expiring[0]?.expiresAt, '2026-12-01T00:00:00.000Z');
});

test('a partial sufficiency raises MISSING_ELEMENTS with the missing list (R7)', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);
  await services.state.putEvidence(storedEvidence({ id: 'ev-b', fields: { ...storedEvidence().fields, documentDate: '2026-10-14' } }));
  const attachment = pendingAttachment({ id: 'at-b', status: 'APPLIED', controlId: 'CONT-03', evidenceId: 'ev-b' });
  await services.state.putAttachment(attachment);
  await services.state.putSufficiency(
    makeSufficiency({
      id: 'sf-b',
      attachmentId: 'at-b',
      evidenceId: 'ev-b',
      controlId: 'CONT-03',
      class: 'PARTIAL',
      missing: ['Recovery time']
    })
  );

  const reminders = await runReminders(services, 'demo-msp');
  const missing = reminders.filter((reminder) => reminder.reason === 'MISSING_ELEMENTS');

  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0]?.missing, ['Recovery time']);
  assert.match(services.sent().find((message) => message.controlId === 'CONT-03')?.body ?? '', /Recovery time/);
});

test('without a framework argument every imported framework is reminded', async () => {
  const services = fakeServices();
  await seed(services, [BACKUP]);
  await services.state.putFramework({ ...(await services.state.getFramework('demo-msp'))!, id: 'second' });
  await services.state.putControls([makeControl({ id: 'CONT-77', frameworkId: 'second', owner: 'ops.lead' })]);

  const reminders = await runReminders(services);
  assert.deepEqual(reminders.map((reminder) => reminder.controlId).sort(), ['CONT-03', 'CONT-77']);
});

test('EF-REL-03: the weekly digest reports readiness, gaps and pending validations', async () => {
  const services = fakeServices();
  await seed(services, [POLICY, BACKUP]);
  await services.state.putValidation(pendingItem({ id: 'va-1', controlId: 'CONT-03' }));

  const message = await weeklyDigest(services, 'demo-msp');

  assert.equal(message.kind, 'WEEKLY_DIGEST');
  assert.equal(message.to, 'quality.lead@msp.demo');
  assert.match(message.subject, /Weekly readiness digest/);
  assert.match(message.body, /NO_EVIDENCE: 2/);
  assert.match(message.body, /CONT-03/);
  assert.match(message.body, /Waiting for your validation/);
  assert.match(message.body, /ATTACHMENT: 1/);
});

test('the digest never describes a control with the forbidden word (ENF-IA-01)', async () => {
  const services = fakeServices();
  await seed(services, [POLICY]);
  const message = await weeklyDigest(services, 'demo-msp');
  assert.equal(/compliant|conform/i.test(message.body), false);
});

test('an unknown framework has no digest', async () => {
  const services = fakeServices();
  await assert.rejects(() => weeklyDigest(services, 'missing'), { code: 'NOT_FOUND' });
});
