/**
 * Optional quote verification: the cited passage must be found in the document
 * itself, not only the right document id cited.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvidenceTexts, quoteSupported } from '../../tools/eval/lib/quotes.ts';
import { scoreQa } from '../../tools/eval/lib/scoring.ts';
import { buildDatasetRows } from '../../tools/eval/lib/rows.ts';

const BUILT = buildDatasetRows();

function evidenceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'registre-evidence-'));
  writeFileSync(join(dir, 'information-security-policy-v4.pdf'), 'Information Security Policy, version 4.0, approved by the Chief Executive Officer.', 'utf8');
  writeFileSync(join(dir, 'office-relocation-plan-2027.pdf'), 'Plan for moving the head office to another building next year.', 'utf8');
  return dir;
}

test('the texts of the demo directory are indexed by evidence id', () => {
  const texts = loadEvidenceTexts(evidenceDir());
  assert.ok(texts.has('EV-001'));
  assert.ok(texts.has('EV-060'));
  assert.equal(texts.get('EV-001')?.[0]?.text.includes('Information Security Policy'), true);
});

test('an absent directory yields no text and no failure', () => {
  const texts = loadEvidenceTexts('/nonexistent-registre-directory');
  assert.equal(texts.size, 0);
  assert.equal(quoteSupported(texts, 'EV-001', 'anything'), true);
});

test('a quote found in the document is supported, a foreign one is not', () => {
  const texts = loadEvidenceTexts(evidenceDir());
  assert.equal(quoteSupported(texts, 'EV-001', 'Information Security Policy, version 4.0'), true);
  assert.equal(quoteSupported(texts, 'EV-001', 'the penetration test passed with no finding'), false);
  assert.equal(quoteSupported(texts, 'EV-001', ''), false);
  assert.equal(quoteSupported(texts, 'EV-001', undefined), false);
});

test('an unknown document keeps the citation acceptable (the text is simply missing)', () => {
  const texts = loadEvidenceTexts(evidenceDir());
  assert.equal(quoteSupported(texts, 'EV-002', 'some passage'), true, 'EV-002 is not in the demo directory');
});

test('a question whose citation is not grounded loses the point', () => {
  const texts = loadEvidenceTexts(evidenceDir());
  const row = BUILT.qa.find((item) => item.questionId === 'Q-01');
  assert.ok(row !== undefined);
  const grounded = scoreQa(BUILT.qa, [
    { questionId: 'Q-01', answerKind: 'EVIDENCE', citations: [{ evidenceId: 'EV-001', quote: 'Information Security Policy, version 4.0' }] }
  ], texts);
  assert.equal(grounded.citationMisses.includes('Q-01'), false);
  const ungrounded = scoreQa(BUILT.qa, [
    { questionId: 'Q-01', answerKind: 'EVIDENCE', citations: [{ evidenceId: 'EV-001', quote: 'a passage that is not in the policy' }] }
  ], texts);
  assert.equal(ungrounded.citationMisses.includes('Q-01'), true);
});

test('without the document texts the citation is judged on the evidence id alone', () => {
  const row = BUILT.qa.find((item) => item.questionId === 'Q-01');
  assert.ok(row !== undefined);
  const score = scoreQa(BUILT.qa, [
    { questionId: 'Q-01', answerKind: 'EVIDENCE', citations: [{ evidenceId: 'EV-001', quote: 'anything at all' }] }
  ], null);
  assert.equal(score.citationMisses.includes('Q-01'), false);
});
