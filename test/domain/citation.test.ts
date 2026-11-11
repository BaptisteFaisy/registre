/**
 * Quote verification tests — EF-RAT-02, ENF-IA-02, EF-QR-01, recette R4.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_QUOTE_LENGTH, isVerifiableQuote, verifyAnswerCitations, verifyQuote } from '../../src/domain/citation.ts';
import type { Answer, Evidence, EvidenceId } from '../../src/domain/types.ts';
import { makeEvidence, TEST_NOW } from '../fixtures/builders.ts';

const PAGES = [
  { page: 1, text: 'Backup policy version 4.0. Scope: all managed environments.' },
  { page: 2, text: 'Restoration of the customer database on 14 October 2026 took 42 minutes.' }
];

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    question: 'What was the last restoration test?',
    text: 'The restoration of the customer database took 42 minutes.',
    citations: [
      {
        evidenceId: 'ev-report',
        title: 'Restoration report',
        page: 2,
        documentDate: '2026-10-14',
        quote: 'Restoration of the customer database on 14 October 2026 took 42 minutes'
      }
    ],
    noEvidence: false,
    redacted: false,
    passagesUsed: 1,
    ...overrides
  };
}

test('R4 — a quote absent from the evidence is not found', () => {
  const evidence = makeEvidence({ textPages: PAGES });
  const check = verifyQuote(evidence, 'Restoration of the payroll system took 3 hours');
  assert.equal(check.found, false);
  assert.equal(check.page, null);
  assert.equal(check.failure, 'NOT_FOUND');
});

test('a real quote is found on the page that carries it', () => {
  const evidence = makeEvidence({ textPages: PAGES });
  const check = verifyQuote(evidence, 'Restoration of the customer database on 14 October 2026');
  assert.equal(check.found, true);
  assert.equal(check.page, 2);
  assert.equal(check.failure, null);
});

test('quote matching tolerates case, spacing and punctuation', () => {
  const evidence = makeEvidence({ textPages: PAGES });
  assert.equal(verifyQuote(evidence, 'BACKUP   policy version 4.0').page, 1);
  assert.equal(verifyQuote(evidence, 'took 42 minutes').found, true);
  assert.equal(verifyQuote(evidence, '“restoration of the customer database”').found, true);
});

test('a quote shorter than the minimum is reported as not verifiable', () => {
  const evidence = makeEvidence({ textPages: PAGES });
  const short = verifyQuote(evidence, '42');
  assert.equal(short.found, false);
  assert.equal(short.failure, 'TOO_SHORT');
  assert.equal(isVerifiableQuote('42'), false);
  assert.equal(isVerifiableQuote('x'.repeat(MIN_QUOTE_LENGTH)), true);
  assert.equal(verifyQuote(evidence, '   ').failure, 'EMPTY');
});

test('an unreadable evidence with no pages cannot verify any quote', () => {
  const evidence = makeEvidence({ textPages: [] });
  assert.equal(verifyQuote(evidence, 'Restoration of the customer database').failure, 'NOT_FOUND');
});

test('answer citations are anchored only when every quote is traced', () => {
  const evidences: Map<EvidenceId, Evidence> = new Map([['ev-report', makeEvidence({ id: 'ev-report', textPages: PAGES })]]);
  const anchored = verifyAnswerCitations(makeAnswer(), evidences);
  assert.equal(anchored.anchored, true);
  assert.deepEqual(anchored.unsupported, []);
  assert.equal(anchored.checks[0]!.page, 2);
});

test('an answer citing a quote that is not in the evidence is not anchored', () => {
  const evidences: Map<EvidenceId, Evidence> = new Map([['ev-report', makeEvidence({ id: 'ev-report', textPages: PAGES })]]);
  const answer = makeAnswer({
    citations: [
      { evidenceId: 'ev-report', title: null, page: null, documentDate: TEST_NOW, quote: 'Restoration took three hours' }
    ]
  });
  const report = verifyAnswerCitations(answer, evidences);
  assert.equal(report.anchored, false);
  assert.deepEqual(report.unsupported, ['Restoration took three hours']);
  assert.equal(report.checks[0]!.failure, 'NOT_FOUND');
});

test('a citation naming an unknown evidence is unsupported', () => {
  const report = verifyAnswerCitations(makeAnswer(), new Map());
  assert.equal(report.anchored, false);
  assert.equal(report.checks[0]!.failure, 'UNKNOWN_EVIDENCE');
});

test('an answer without citation is never anchored', () => {
  const report = verifyAnswerCitations(makeAnswer({ citations: [] }), new Map());
  assert.equal(report.anchored, false);
  assert.deepEqual(report.checks, []);
});
