/**
 * Access control tests — ENF-CONF-01, ENF-CONF-02, EF-QR-03, recette R13.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedLevels,
  canDecide,
  canReadControl,
  canReadEvidence,
  denialEvent,
  filterPassages,
  filterPassagesWithDenials,
  isLevelAllowed,
  levelsUpTo,
  maxLevel
} from '../../src/domain/access.ts';
import type { Passage } from '../../src/domain/types.ts';
import { makeEvidence, makePrincipal, makeValidation } from '../fixtures/builders.ts';

const passage = (evidenceId: string, accessLevel: Passage['accessLevel']): Passage => ({
  evidenceId,
  title: 'Excerpt',
  documentDate: '2026-10-01',
  page: 1,
  text: 'Passage text',
  score: 0.9,
  accessLevel
});

const executive = makePrincipal({ id: 'u-exec', role: 'EXECUTIVE', clearance: 'INTERNAL' });
const auditor = makePrincipal({ id: 'u-audit', role: 'INTERNAL_AUDITOR', clearance: 'INTERNAL' });
const qualityLead = makePrincipal({ id: 'u-quality', role: 'QUALITY_LEAD', clearance: 'RESTRICTED' });
const owner = makePrincipal({ id: 'u-owner', role: 'CONTROL_OWNER', clearance: 'INTERNAL', ownedControls: ['CONT-01'] });

test('each role gets its access levels', () => {
  assert.deepEqual(allowedLevels(qualityLead), ['PUBLIC', 'INTERNAL', 'RESTRICTED']);
  assert.deepEqual(allowedLevels(makePrincipal({ role: 'ADMIN' })), ['PUBLIC', 'INTERNAL', 'RESTRICTED']);
  assert.deepEqual(allowedLevels(executive), ['PUBLIC', 'INTERNAL']);
  assert.deepEqual(allowedLevels(owner), ['PUBLIC', 'INTERNAL']);
  assert.deepEqual(levelsUpTo('PUBLIC'), ['PUBLIC']);
});

test('a personal clearance below the role ceiling caps the levels', () => {
  const restrictedLead = makePrincipal({ role: 'QUALITY_LEAD', clearance: 'INTERNAL' });
  assert.equal(maxLevel(restrictedLead), 'INTERNAL');
  assert.deepEqual(allowedLevels(restrictedLead), ['PUBLIC', 'INTERNAL']);
  assert.equal(isLevelAllowed('RESTRICTED', maxLevel(restrictedLead)), false);
});

test('R13 — a restricted evidence is invisible to an executive', () => {
  const restricted = makeEvidence({ accessLevel: 'RESTRICTED' });
  const decision = canReadEvidence(executive, restricted);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ROLE_NOT_ALLOWED');
  assert.equal(canReadEvidence(auditor, restricted).allowed, false);
  assert.equal(canReadEvidence(qualityLead, restricted).allowed, true);
});

test('a control owner reads internal evidence of its own controls only', () => {
  const evidence = makeEvidence({ accessLevel: 'INTERNAL' });
  assert.equal(canReadEvidence(owner, evidence, ['CONT-01']).allowed, true);
  const other = canReadEvidence(owner, evidence, ['CONT-02']);
  assert.equal(other.allowed, false);
  assert.equal(other.reason, 'NOT_CONTROL_OWNER');
  assert.equal(canReadEvidence(owner, evidence).allowed, false);
  assert.equal(canReadControl(owner, 'CONT-01').allowed, true);
  assert.equal(canReadControl(qualityLead, 'CONT-99').allowed, true);
});

test('R13 — restricted passages never reach an executive', () => {
  const passages = [passage('ev-public', 'PUBLIC'), passage('ev-internal', 'INTERNAL'), passage('ev-hr', 'RESTRICTED')];
  assert.deepEqual(filterPassages(executive, passages).map((p) => p.evidenceId), ['ev-public', 'ev-internal']);
  assert.equal(filterPassages(qualityLead, passages).length, 3);
  const filtered = filterPassagesWithDenials(executive, passages);
  assert.deepEqual(filtered.allowed.map((p) => p.evidenceId), ['ev-public', 'ev-internal']);
  assert.deepEqual(filtered.denied, ['ev-hr']);
});

test('only the quality lead and the admin decide a pending validation', () => {
  const pending = makeValidation({ status: 'PENDING' });
  assert.equal(canDecide(qualityLead, pending).allowed, true);
  assert.equal(canDecide(makePrincipal({ role: 'ADMIN' }), pending).allowed, true);
  assert.equal(canDecide(executive, pending).reason, 'ROLE_NOT_ALLOWED');
  assert.equal(canDecide(owner, pending).reason, 'ROLE_NOT_ALLOWED');
  assert.equal(canDecide(qualityLead, makeValidation({ status: 'DECIDED' })).reason, 'ALREADY_DECIDED');
});

test('a refusal can be journalised as an ACCESS_DENIED event', () => {
  const decision = canReadEvidence(executive, makeEvidence({ accessLevel: 'RESTRICTED' }));
  const event = denialEvent(executive, decision, 'EVIDENCE', 'ev-hr');
  assert.equal(event.action, 'ACCESS_DENIED');
  assert.equal(event.actor, 'u-exec');
  assert.equal(event.objectType, 'EVIDENCE');
  assert.equal(event.objectId, 'ev-hr');
  assert.deepEqual(event.detail, { reason: 'ROLE_NOT_ALLOWED', role: 'EXECUTIVE', clearance: 'INTERNAL' });
});
