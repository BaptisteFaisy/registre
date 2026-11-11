import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFreshness,
  computeReadiness,
  computeSufficiencyClass,
  evaluateControl,
  referenceDate,
  verifyQuote
} from '../../src/domain/engine.ts';
import type { Attachment, Control, Evidence, Sufficiency } from '../../src/domain/types.ts';

const NOW = '2026-11-11T12:00:00Z';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'CONT-03',
    frameworkId: 'demo-msp',
    domain: 'Continuité',
    title: 'Test de restauration des sauvegardes',
    requirement: 'Les sauvegardes sont testées par une restauration réelle.',
    expectedEvidence: ['Date du test', 'Durée de reprise mesurée', 'Résultat', 'Signataire'],
    periodicity: 'P3M',
    owner: 'responsable.exploitation',
    mandatory: true,
    ...overrides
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-test-1',
    sha256: 'a'.repeat(64),
    revision: 1,
    fields: {
      type: 'REPORT',
      title: 'Compte rendu restauration S3',
      documentDate: '2026-10-14',
      period: { start: null, end: null },
      version: '1.0',
      author: 'L. Moreau',
      approver: 'L. Moreau',
      approvalDate: '2026-10-14',
      client: null,
      summary: 'Restauration réussie.',
      personalData: false
    },
    flags: { unreadable: false, missingDate: false, missingAuthor: false, dateToConfirm: false },
    accessLevel: 'INTERNAL',
    locations: [{ kind: 'MANUAL', uri: 'manual://test.pdf', collectedAt: NOW }],
    textPages: [{ page: 1, text: 'Restauration de la base clients le 14 octobre 2026, durée 42 min. Signé: L. Moreau' }],
    sizeBytes: 1024,
    contentType: 'application/pdf',
    ingestedAt: NOW,
    reader: 'mock',
    ...overrides
  };
}

test('verifyQuote detects quoted passage and rejects hallucinated ones', () => {
  const ev = makeEvidence();
  const text = ev.textPages[0]!.text;
  assert.equal(verifyQuote(text, 'durée 42 min').found, true);
  assert.equal(verifyQuote(text, 'restauration hallucinée').found, false);
});

test('computeSufficiencyClass separates complete from partial', () => {
  const complete = computeSufficiencyClass([
    { expected: 'A', present: true, quote: 'a' },
    { expected: 'B', present: true, quote: 'b' }
  ]);
  assert.equal(complete.class, 'COMPLETE');
  assert.deepEqual(complete.missing, []);

  const partial = computeSufficiencyClass([
    { expected: 'A', present: true, quote: 'a' },
    { expected: 'B', present: false, quote: null }
  ]);
  assert.equal(partial.class, 'PARTIAL');
  assert.deepEqual(partial.missing, ['B']);
});

test('computeFreshness applies 30-day lead time rule', () => {
  const ev = makeEvidence({
    fields: { ...makeEvidence().fields, documentDate: '2026-09-01' }
  });
  // P3M -> 2026-12-01. Days from 2026-11-11 to 2026-12-01 = 20 days -> TO_RENEW
  const renew = computeFreshness(ev, 'P3M', NOW);
  assert.equal(renew.freshness, 'TO_RENEW');

  // Policy dated 18 months ago -> EXPIRED (spec scenario R5)
  const oldEv = makeEvidence({
    fields: { ...makeEvidence().fields, documentDate: '2025-05-01' }
  });
  const expired = computeFreshness(oldEv, 'P1Y', NOW);
  assert.equal(expired.freshness, 'EXPIRED');
});

test('evaluateControl derives COVERED only when fresh, complete and validated', () => {
  const control = makeControl();
  const ev = makeEvidence();
  const att: Attachment = {
    id: 'at-1',
    evidenceId: ev.id,
    controlId: control.id,
    frameworkId: control.frameworkId,
    supports: true,
    confidence: 0.95,
    quote: 'durée 42 min',
    quoteLocation: { page: 1 },
    reason: 'Matches requirement',
    status: 'APPLIED',
    citationVerified: true,
    autoApplied: true,
    model: 'mock',
    createdAt: NOW
  };
  const suf: Sufficiency = {
    id: 'sf-1',
    attachmentId: att.id,
    evidenceId: ev.id,
    controlId: control.id,
    elements: control.expectedEvidence.map((e) => ({ expected: e, present: true, quote: 'x' })),
    class: 'COMPLETE',
    missing: [],
    computedAt: NOW
  };

  // Mandatory control, first time -> TO_VERIFY until human validates (spec 12.4)
  const first = evaluateControl({
    control,
    attachments: [att],
    evidences: new Map([[ev.id, ev]]),
    sufficiencies: new Map([[att.id, suf]]),
    isTypeValidated: false,
    now: NOW
  });
  assert.equal(first.state, 'TO_VERIFY');

  // Once type is validated -> COVERED
  const confirmed = evaluateControl({
    control,
    attachments: [att],
    evidences: new Map([[ev.id, ev]]),
    sufficiencies: new Map([[att.id, suf]]),
    isTypeValidated: true,
    now: NOW
  });
  assert.equal(confirmed.state, 'COVERED');
  assert.equal(confirmed.freshness, 'FRESH');
});

test('computeReadiness produces shares summing to 1', () => {
  const readiness = computeReadiness(
    'demo-msp',
    [
      { controlId: 'C1', frameworkId: 'demo-msp', state: 'COVERED', freshness: 'FRESH', sufficiencyClass: 'COMPLETE', bestEvidenceId: 'e1', expiresAt: null, pendingProposals: 0, notes: [], computedAt: NOW },
      { controlId: 'C2', frameworkId: 'demo-msp', state: 'NO_EVIDENCE', freshness: 'UNDETERMINED', sufficiencyClass: null, bestEvidenceId: null, expiresAt: null, pendingProposals: 0, notes: [], computedAt: NOW }
    ],
    NOW
  );
  assert.equal(readiness.total, 2);
  assert.equal(readiness.counts.COVERED, 1);
  assert.equal(readiness.counts.NO_EVIDENCE, 1);
  assert.equal(readiness.shares.COVERED, 0.5);
  assert.equal(readiness.shares.NO_EVIDENCE, 0.5);
});
