/**
 * Annex C / Annex D shape validation — the hand-written validator shared by the
 * Bedrock reasoner and the mock (no external dependency, EF-RAT-02, EF-SUF-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProposedAttachment,
  normaliseConfidence,
  parseAttachmentProposals,
  parseDraftAnswer,
  parseJsonPayload,
  parseSufficiencyElements
} from '../../src/ai/schemas.ts';
import type { ProposedAttachment } from '../../src/ports/index.ts';

const VALID: ProposedAttachment = {
  controlId: 'CONT-03',
  supports: true,
  confidence: 0.91,
  quote: 'Restoration of the customer database on 14 October 2026 took 42 minutes.',
  page: 2,
  reason: 'The report describes a real restore, which the control requires.'
};

test('isProposedAttachment accepts the Annex C shape and rejects partial objects', () => {
  assert.equal(isProposedAttachment(VALID), true);
  assert.equal(isProposedAttachment({ ...VALID, confidence: '0.9' }), false);
  assert.equal(isProposedAttachment({ ...VALID, page: '2' }), false);
  assert.equal(isProposedAttachment({ controlId: 'CONT-03' }), false);
  assert.equal(isProposedAttachment(null), false);
});

test('parseAttachmentProposals keeps valid entries and drops the rest', () => {
  const payload = [VALID, { ...VALID, controlId: 'CONT-99' }, { controlId: 'CONT-04' }, 'nonsense'];
  const proposals = parseAttachmentProposals(payload, ['CONT-03', 'CONT-04']);
  assert.equal(proposals.length, 2);
  assert.deepEqual(
    proposals.map((proposal) => proposal.controlId),
    ['CONT-03', 'CONT-04']
  );
  for (const proposal of proposals) assert.equal(isProposedAttachment(proposal), true);
});

test('a proposal without a usable quote is downgraded, never applied', () => {
  const proposals = parseAttachmentProposals([{ ...VALID, quote: 'ok' }]);
  assert.equal(proposals[0]?.supports, false);
  assert.equal(proposals[0]?.confidence, 0);
  assert.equal(proposals[0]?.quote, '');
});

test('confidence is clamped and a percentage answer is rescaled', () => {
  assert.equal(normaliseConfidence(91), 0.91);
  assert.equal(normaliseConfidence(1.7), 0.017, 'above 1 is read as a percentage, erring towards review');
  assert.equal(normaliseConfidence(-3), 0);
  assert.equal(normaliseConfidence('0.5'), 0.5);
  assert.equal(normaliseConfidence('abc'), 0);
});

test('an object wrapping the array is accepted as well', () => {
  const proposals = parseAttachmentProposals({ attachments: [VALID] });
  assert.equal(proposals.length, 1);
  const elements = parseSufficiencyElements({ elements: [{ expected: 'Test date', present: true, quote: 'le 14 octobre 2026' }] }, ['Test date']);
  assert.equal(elements[0]?.present, true);
});

test('parseSufficiencyElements follows the expected list, in order', () => {
  const expected = ['Test date', 'Recovery time', 'Signatory'];
  const payload = [
    { expected: 'signatory', present: true, quote: 'Signed: L. Moreau, 14 October 2026' },
    { expected: 'Test date', present: true, quote: 'on 14 October 2026' },
    { expected: 'Recovery time', present: false, quote: null }
  ];
  const elements = parseSufficiencyElements(payload, expected);
  assert.deepEqual(
    elements.map((element) => element.expected),
    expected
  );
  assert.deepEqual(
    elements.map((element) => element.present),
    [true, false, true]
  );
  assert.equal(elements[1]?.quote, null);
});

test('a missing element is reported absent, not invented', () => {
  const elements = parseSufficiencyElements([{ expected: 'Test date', present: true, quote: 'on 14 October 2026' }], [
    'Test date',
    'Recovery time'
  ]);
  assert.equal(elements[1]?.expected, 'Recovery time');
  assert.equal(elements[1]?.present, false);
  assert.equal(elements[1]?.quote, null);
});

test('parseDraftAnswer drops citations pointing outside the retrieved passages', () => {
  const draft = parseDraftAnswer(
    {
      text: 'The restore took 42 minutes.',
      citations: [
        { evidenceId: 'ev-1', quote: 'took 42 minutes', page: 2 },
        { evidenceId: 'ev-9', quote: 'a passage that was never retrieved', page: 1 },
        { evidenceId: 'ev-1', quote: 'short', page: null }
      ]
    },
    ['ev-1']
  );
  assert.equal(draft.citations.length, 1);
  assert.equal(draft.citations[0]?.evidenceId, 'ev-1');
  assert.equal(draft.text, 'The restore took 42 minutes.');
});

test('parseJsonPayload tolerates a fenced block and rejects prose', () => {
  assert.deepEqual(parseJsonPayload('```json\n[{"a":1}]\n```', 'test'), [{ a: 1 }]);
  assert.throws(() => parseJsonPayload('I cannot answer this question.', 'test'), /model returned no JSON/);
});
