/**
 * Control state tests — EF-FRA-02 (spec 12.3 matrix, 12.4 prudence rules),
 * recette R5.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateControl, STATE_NOTES, STATE_NOTE_TEXT } from '../../src/domain/states.ts';
import type {
  Attachment,
  Control,
  ControlStatus,
  Evidence,
  Sufficiency,
  SufficiencyClass
} from '../../src/domain/types.ts';
import {
  makeAttachment,
  makeControl,
  makeElements,
  makeEvidence,
  makeFields,
  makeFlags,
  makeSufficiency,
  TEST_NOW
} from '../fixtures/builders.ts';

interface Scenario {
  control?: Partial<Control>;
  evidence?: Partial<Evidence>;
  sufficiencyClass?: SufficiencyClass;
  isTypeValidated?: boolean;
  attachment?: Partial<Attachment>;
}

function sufficiencyOf(attachment: Attachment, evidence: Evidence, control: Control, klass: SufficiencyClass): Sufficiency {
  const elements = makeElements(klass === 'COMPLETE' ? [true, true, true, true] : [true, true, false, true]);
  return makeSufficiency({ attachmentId: attachment.id, evidenceId: evidence.id, controlId: control.id, elements, class: klass, missing: klass === 'PARTIAL' ? ['Version'] : [] });
}

function evaluate(scenario: Scenario = {}): ControlStatus {
  const control = makeControl(scenario.control);
  const evidence = makeEvidence({ id: 'ev-1', ...scenario.evidence });
  const attachment = makeAttachment({ evidenceId: evidence.id, controlId: control.id, ...scenario.attachment });
  const sufficiency = sufficiencyOf(attachment, evidence, control, scenario.sufficiencyClass ?? 'COMPLETE');
  return evaluateControl({
    control,
    attachments: [attachment],
    evidences: new Map([[evidence.id, evidence]]),
    sufficiencies: new Map([[attachment.id, sufficiency]]),
    isTypeValidated: scenario.isTypeValidated ?? true,
    now: TEST_NOW
  });
}

const FRESH_DOC = { fields: makeFields({ documentDate: '2026-10-01' }) };

test('a control without any attachment has no evidence', () => {
  const status = evaluateControl({
    control: makeControl(),
    attachments: [],
    evidences: new Map(),
    sufficiencies: new Map(),
    isTypeValidated: true,
    now: TEST_NOW
  });
  assert.equal(status.state, 'NO_EVIDENCE');
  assert.equal(status.freshness, 'UNDETERMINED');
  assert.equal(status.bestEvidenceId, null);
  assert.equal(status.computedAt, TEST_NOW);
});

test('only proposed attachments leave the control to verify', () => {
  const status = evaluate({ attachment: { status: 'PROPOSED' } });
  assert.equal(status.state, 'TO_VERIFY');
  assert.equal(status.pendingProposals, 1);
  assert.match(status.notes.join(' '), /proposed/);
});

test('a rejected or unsupporting attachment never covers a control', () => {
  assert.equal(evaluate({ attachment: { status: 'REJECTED' } }).state, 'NO_EVIDENCE');
  assert.equal(evaluate({ attachment: { supports: false } }).state, 'NO_EVIDENCE');
});

test('12.4 — a mandatory control needs one human validation of the evidence type first', () => {
  const pending = evaluate({ isTypeValidated: false });
  assert.equal(pending.state, 'TO_VERIFY');
  assert.deepEqual(pending.notes, [STATE_NOTES.mandatoryFirstValidation]);
  assert.equal(evaluate({ isTypeValidated: true }).state, 'COVERED');
});

test('a non-mandatory control is covered without a first validation', () => {
  const status = evaluate({ control: { mandatory: false }, isTypeValidated: false });
  assert.equal(status.state, 'COVERED');
  assert.equal(status.freshness, 'FRESH');
  assert.equal(status.sufficiencyClass, 'COMPLETE');
});

test('12.4 — an evidence whose date must be confirmed cannot cover the control', () => {
  const status = evaluate({ evidence: { ...FRESH_DOC, flags: makeFlags({ dateToConfirm: true }) } });
  assert.equal(status.state, 'TO_VERIFY');
  assert.deepEqual(status.notes, [STATE_NOTES.dateToConfirm]);
});

test('12.4 — an evidence without a readable date cannot cover the control', () => {
  const missingDate = evaluate({ evidence: { ...FRESH_DOC, flags: makeFlags({ missingDate: true }) } });
  assert.equal(missingDate.state, 'TO_VERIFY');
  assert.deepEqual(missingDate.notes, [STATE_NOTES.dateMissing]);
  const undated = evaluate({ evidence: { fields: makeFields({ documentDate: null, approvalDate: null }) } });
  assert.equal(undated.state, 'TO_VERIFY');
  assert.equal(undated.freshness, 'UNDETERMINED');
});

test('an unreadable evidence goes to verify', () => {
  const status = evaluate({ evidence: { flags: makeFlags({ unreadable: true }) } });
  assert.equal(status.state, 'TO_VERIFY');
  assert.deepEqual(status.notes, [STATE_NOTES.evidenceUnreadable]);
});

test('12.4 — partial sufficiency sends a fresh evidence to verify, never to covered', () => {
  const status = evaluate({ sufficiencyClass: 'PARTIAL' });
  assert.equal(status.state, 'TO_VERIFY');
  assert.equal(status.sufficiencyClass, 'PARTIAL');
  assert.deepEqual(status.notes, [STATE_NOTES.sufficiencyIncomplete]);
});

test('a complete evidence inside the renewal window gives to renew', () => {
  const status = evaluate({ evidence: { fields: makeFields({ documentDate: '2025-12-11' }) } });
  assert.equal(status.state, 'TO_RENEW');
  assert.equal(status.freshness, 'TO_RENEW');
  assert.deepEqual(status.notes, [STATE_NOTES.expiresSoon]);
});

test('R5 — an expired policy leaves the control expired once the type is validated', () => {
  const status = evaluate({ evidence: { fields: makeFields({ documentDate: '2025-05-11' }) } });
  assert.equal(status.state, 'EXPIRED');
  assert.equal(status.freshness, 'EXPIRED');
  assert.deepEqual(status.notes, [STATE_NOTES.expired]);
});

test('R5 — prudence never hides an expiry: an unvalidated mandatory control stays expired', () => {
  // 12.4 only prevents an upgrade to COVERED. Downgrading EXPIRED to TO_VERIFY
  // would hide the very situation R5 asks the tool to surface.
  const status = evaluate({ evidence: { fields: makeFields({ documentDate: '2025-05-11' }) }, isTypeValidated: false });
  assert.equal(status.state, 'EXPIRED');
  assert.equal(status.freshness, 'EXPIRED');
  assert.deepEqual(status.notes, [STATE_NOTES.expired, STATE_NOTES.mandatoryFirstValidation]);
});

test('12.4 — an expired and partial evidence is to verify, not expired', () => {
  const status = evaluate({ evidence: { fields: makeFields({ documentDate: '2025-05-11' }) }, sufficiencyClass: 'PARTIAL' });
  assert.equal(status.state, 'TO_VERIFY');
  assert.equal(status.freshness, 'EXPIRED');
});

test('the freshest complete evidence wins among several applied attachments', () => {
  const control = makeControl();
  const fresh = makeEvidence({ id: 'ev-fresh', fields: makeFields({ documentDate: '2026-10-01' }) });
  const old = makeEvidence({ id: 'ev-old', fields: makeFields({ documentDate: '2024-01-01' }) });
  const freshAtt = makeAttachment({ evidenceId: fresh.id, controlId: control.id, id: 'at-fresh' });
  const oldAtt = makeAttachment({ evidenceId: old.id, controlId: control.id, id: 'at-old' });
  const status = evaluateControl({
    control,
    attachments: [oldAtt, freshAtt],
    evidences: new Map([[fresh.id, fresh], [old.id, old]]),
    sufficiencies: new Map([
      [freshAtt.id, sufficiencyOf(freshAtt, fresh, control, 'COMPLETE')],
      [oldAtt.id, sufficiencyOf(oldAtt, old, control, 'COMPLETE')]
    ]),
    isTypeValidated: true,
    now: TEST_NOW
  });
  assert.equal(status.state, 'COVERED');
  assert.equal(status.bestEvidenceId, 'ev-fresh');
});

test('an attachment pointing at a missing evidence is ignored', () => {
  const status = evaluateControl({
    control: makeControl(),
    attachments: [makeAttachment({ evidenceId: 'ev-ghost' })],
    evidences: new Map(),
    sufficiencies: new Map(),
    isTypeValidated: true,
    now: TEST_NOW
  });
  assert.equal(status.state, 'NO_EVIDENCE');
  assert.equal(status.bestEvidenceId, null);
});

test('every note code carries a human sentence for packs and reminders', () => {
  for (const code of Object.values(STATE_NOTES)) {
    assert.equal(typeof STATE_NOTE_TEXT[code], 'string', `${code} must have a sentence`);
    assert.ok(STATE_NOTE_TEXT[code]!.length > 10);
  }
});
