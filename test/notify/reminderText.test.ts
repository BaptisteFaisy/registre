/**
 * Reminder text — EF-REL-01 (renew before expiry, say which evidence to
 * provide) and EF-REL-02 (remind for a control without evidence).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceToProvide,
  reasonSentence,
  reminderBody,
  reminderMessage,
  reminderSubject
} from '../../src/notify/reminderText.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';
import { makeControl, TEST_NOW } from '../fixtures/builders.ts';

const control = makeControl({
  id: 'CONT-03',
  title: 'Backup restore is tested',
  periodicity: 'P3M',
  expectedEvidence: ['Test date', 'Restored system', 'Measured recovery time', 'Result', 'Signatory']
});

test('subject: names the control and says what is expected (EF-REL-01)', () => {
  const subject = reminderSubject({ control, reason: 'EXPIRING_SOON', recipient: 'ops@msp.demo' });
  assert.match(subject, /^Evidence to renew: CONT-03/);
  assert.match(subject, /Backup restore is tested/);
  assert.match(
    reminderSubject({ control, reason: 'NO_EVIDENCE', recipient: 'ops@msp.demo' }),
    /^Evidence required:/
  );
});

test('body: a renewal reminder states the expiry date', () => {
  const body = reminderBody({
    control,
    reason: 'EXPIRING_SOON',
    recipient: 'ops@msp.demo',
    expiresAt: '2026-12-01T00:00:00.000Z',
    now: TEST_NOW
  });
  assert.match(body, /expires on 2026-12-01/);
  assert.match(body, /Renewal period: P3M/);
});

test('body: a control without evidence says so explicitly (EF-REL-02)', () => {
  const body = reminderBody({ control, reason: 'NO_EVIDENCE', recipient: 'ops@msp.demo' });
  assert.match(body, /No evidence has been recorded for this control yet/);
});

test('body: the evidence to provide lists every expected element', () => {
  const lines = evidenceToProvide({ control, reason: 'NO_EVIDENCE', recipient: 'ops@msp.demo' });
  assert.deepEqual(lines, control.expectedEvidence);

  const body = reminderBody({ control, reason: 'NO_EVIDENCE', recipient: 'ops@msp.demo' });
  for (const element of control.expectedEvidence) {
    assert.ok(body.includes(element), `the body must name "${element}"`);
  }
});

test('body: the elements still missing are listed separately (R7, EF-REL-01)', () => {
  const missing = ['Measured recovery time'];
  const body = reminderBody({
    control,
    reason: 'MISSING_ELEMENTS',
    recipient: 'ops@msp.demo',
    missing
  });

  assert.match(body, /Still missing from the last document:/);
  assert.match(body, /  - Measured recovery time/);
  assert.match(reasonSentence({ control, reason: 'MISSING_ELEMENTS', recipient: 'ops@msp.demo' }), /does not contain/);
});

test('body: a control without expected elements still asks for a document', () => {
  const bare = makeControl({ expectedEvidence: [] });
  const lines = evidenceToProvide({ control: bare, reason: 'NO_EVIDENCE', recipient: 'ops@msp.demo' });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /supports this control/);
});

test('body: the expected evidence type is shown when the reader knows it', () => {
  const body = reminderBody({
    control,
    reason: 'EXPIRING_SOON',
    recipient: 'ops@msp.demo',
    evidenceType: 'REPORT',
    frameworkName: 'Demonstration framework'
  });
  assert.match(body, /Evidence to provide \(REPORT\):/);
  assert.match(body, /Framework: Demonstration framework/);
});

test('message: the notification is addressed to the owner and typed REMINDER', () => {
  const message = reminderMessage({
    control,
    reason: 'EXPIRING_SOON',
    recipient: 'ops.owner@msp.demo',
    expiresAt: '2026-12-01T00:00:00.000Z'
  });

  assert.equal(message.to, 'ops.owner@msp.demo');
  assert.equal(message.kind, 'REMINDER');
  assert.equal(message.controlId, 'CONT-03');
  assert.ok(message.body.length > 0);
});

test('wording: no reminder ever judges a control (ENF-IA-01)', () => {
  const bodies = (['EXPIRING_SOON', 'NO_EVIDENCE', 'MISSING_ELEMENTS'] as const).map((reason) =>
    reminderBody({ control, reason, recipient: 'ops@msp.demo', missing: ['Test date'] })
  );
  for (const body of bodies) assert.equal(containsForbiddenWord(body), false);
});
