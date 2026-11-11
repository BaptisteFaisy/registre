import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from './store.ts';
import { answerQuestion } from './ask.ts';
import { computeSnapshot } from './engine.ts';
import { buildPack } from './activity.ts';
import { NO_EVIDENCE_ANSWER } from '../api/types.ts';
import type { ControlState } from '../api/types.ts';

const store = createStore();
const db = store.db;

const STATES: ControlState[] = ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE'];

test('the demo framework holds 30 controls over 6 domains', () => {
  assert.equal(db.controls.length, 30);
  assert.equal(new Set(db.controls.map((item) => item.domain)).size, 6);
  for (const control of db.controls) {
    assert.ok(control.expectedEvidence.length > 0, control.id);
    assert.ok(control.owner.length > 0, control.id);
    assert.match(control.periodicity, /^P\d+[DWMY]$/);
  }
});

test('the vault holds about sixty evidence files with varied shapes', () => {
  assert.ok(db.evidence.length >= 55 && db.evidence.length <= 70, String(db.evidence.length));
  assert.ok(new Set(db.evidence.map((item) => item.contentType)).size >= 3);
  assert.ok(new Set(db.evidence.map((item) => item.fields.type)).size >= 5);
});

test('all five control states are represented', () => {
  const snapshot = computeSnapshot(db.framework.id, db.statuses, db.now);
  assert.equal(snapshot.total, 30);
  for (const state of STATES) {
    assert.ok(snapshot.counts[state] > 0, `no control in state ${state}`);
  }
});

test('the validation queue holds four pending items of three kinds', () => {
  const pending = store.validations.filter((item) => item.status === 'PENDING');
  assert.equal(pending.length, 4);
  assert.equal(new Set(pending.map((item) => item.kind)).size, 3);
});

test('two reminders and two frozen packs are seeded', () => {
  assert.equal(store.reminders.length, 2);
  assert.equal(store.packs.length, 2);
  assert.equal(store.packs[0]?.index.length, 30);
  assert.ok((store.packs[0]?.knownGaps.length ?? 0) > 0);
  assert.equal(store.packs[1]?.id, 'pk-002');
});

test('the audit trail is hash-chained', () => {
  assert.ok(store.audit.length >= 20);
  for (let index = 1; index < store.audit.length; index += 1) {
    assert.equal(store.audit[index]?.prevHash, store.audit[index - 1]?.hash);
  }
});

test('seeded situation: the security policy was not reviewed for eighteen months', () => {
  const policy = db.evidence.find((item) => item.id === 'ev-024');
  assert.equal(policy?.fields.documentDate, '2025-05-04');
  assert.equal(db.statuses.find((item) => item.controlId === 'SEC-01')?.state, 'EXPIRED');
});

test('seeded situation: no restore test this quarter', () => {
  const status = db.statuses.find((item) => item.controlId === 'BCP-02');
  assert.ok(status?.state === 'TO_RENEW' || status?.state === 'EXPIRED', String(status?.state));
});

test('seeded situation: a rehearsal minute without a recovery time', () => {
  const sufficiency = db.sufficiencies.find((item) => item.controlId === 'BCP-03');
  assert.ok(sufficiency?.missing.includes('measured recovery time'));
  assert.equal(db.statuses.find((item) => item.controlId === 'BCP-03')?.state, 'TO_VERIFY');
});

test('seeded situation: an unsigned procedure', () => {
  assert.equal(db.evidence.find((item) => item.id === 'ev-026')?.fields.approver, null);
  assert.equal(db.statuses.find((item) => item.controlId === 'SEC-03')?.state, 'TO_VERIFY');
});

test('seeded situation: a misfiled document and a duplicate', () => {
  const misfiled = store.validations.find((item) => item.evidenceId === 'ev-032');
  assert.equal(misfiled?.kind, 'ATTACHMENT');
  const duplicate = db.evidence.find((item) => item.id === 'ev-033');
  const original = db.evidence.find((item) => item.id === 'ev-025');
  assert.equal(duplicate?.revision, 2);
  assert.equal(duplicate?.sha256, original?.sha256);
  assert.ok(duplicate?.locations.some((location) => location.duplicate));
});

test('a rejected attachment keeps its citation-check failure', () => {
  const rejected = db.attachments.find((item) => item.status === 'REJECTED');
  assert.equal(rejected?.citationVerified, false);
  assert.equal(rejected?.rejectionReason, 'CITATION_NOT_FOUND');
});

test('a question with evidence is answered with a citation', () => {
  const answer = answerQuestion(
    'Show the last backup restore test and its recovery time',
    db.evidence,
    'RESTRICTED'
  );
  assert.equal(answer.noEvidence, false);
  assert.ok(answer.citations.length > 0);
  assert.ok(answer.citations[0]?.page);
});

test('a question without evidence says so instead of inventing an answer', () => {
  const answer = answerQuestion('What is our mean time to hire a barista?', db.evidence, 'RESTRICTED');
  assert.equal(answer.noEvidence, true);
  assert.equal(answer.text, NO_EVIDENCE_ANSWER);
  assert.equal(answer.citations.length, 0);
});

test('restricted evidence is never quoted to a role without the clearance', () => {
  const question = 'Show the on-call roster for November';
  const restricted = answerQuestion(question, db.evidence, 'RESTRICTED');
  const internal = answerQuestion(question, db.evidence, 'INTERNAL');
  assert.ok(restricted.citations.some((citation) => citation.evidenceId === 'ev-011'));
  assert.equal(
    internal.citations.some((citation) => citation.evidenceId === 'ev-011'),
    false
  );
});

test('the pack lists the known gaps of the uncovered controls', () => {
  const pack = buildPack(db);
  assert.equal(pack.index.length, 30);
  assert.equal(pack.knownGaps.length, db.statuses.filter((item) => item.state !== 'COVERED').length);
  assert.equal(pack.checksumsVerified, true);
});
