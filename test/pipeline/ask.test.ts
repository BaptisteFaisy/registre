/**
 * Questions and answers — EF-QR-01 (document, page and date cited), EF-QR-02
 * ("aucune preuve ne répond" rather than a guess) and EF-QR-03 (a restricted
 * evidence is never cited to a principal without clearance).
 * Acceptance R11, R12, R13.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { askQuestion } from '../../src/pipeline/ask.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { citation, fakeServices, passage, principal } from './fakeServices.ts';

const QUOTE = 'reviewed on 1 August 2026 and approved by C. Bernard';

/** Bundle whose composer cites the policy passage. */
function citingBundle(overrides: Parameters<typeof fakeServices>[0] = {}) {
  return fakeServices({
    passages: [passage()],
    draft: {
      text: `According to "Information security policy", page 1, dated 2026-08-01: "${QUOTE}"`,
      citations: [citation({ quote: QUOTE })],
      cost: { usd: 0.004, tokensIn: 2100, tokensOut: 120, source: 'fake-composer' }
    },
    ...overrides
  });
}

test('R11: the answer cites the document, the page and the date', async () => {
  const services = citingBundle();
  const answer = await askQuestion(services, principal({ role: 'QUALITY_LEAD', clearance: 'RESTRICTED' }), 'When was the policy reviewed?');

  assert.equal(answer.noEvidence, false);
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.citations[0]?.title, 'Information security policy');
  assert.equal(answer.citations[0]?.page, 1);
  assert.equal(answer.citations[0]?.documentDate, '2026-08-01');
  assert.equal(answer.citations[0]?.quote, QUOTE);
  assert.equal(answer.passagesUsed, 1);
  assert.equal(answer.cost?.usd, 0.004);
  assert.equal(services.costs.report().count, 1, 'the answer cost is metered');
  assert.equal(services.events('QUESTION_ASKED')[0]?.detail.citations, 1);
});

test('R12: a question nothing answers returns NO_EVIDENCE_ANSWER', async () => {
  const services = citingBundle({ passages: [] });
  const answer = await askQuestion(services, principal(), 'What is our carbon footprint?');

  assert.equal(answer.noEvidence, true);
  assert.equal(answer.text, NO_EVIDENCE_ANSWER);
  assert.deepEqual(answer.citations, []);
  assert.equal(answer.passagesUsed, 0);
  assert.equal(services.events('QUESTION_ASKED')[0]?.detail.noEvidence, true);
});

test('an unanchored draft is replaced by the no-evidence answer (ENF-IA-02)', async () => {
  const services = citingBundle({
    anchored: false,
    draft: {
      text: 'According to the policy: "the policy is audited every year by an external firm"',
      citations: [citation({ quote: 'the policy is audited every year by an external firm' })]
    }
  });
  const answer = await askQuestion(services, principal(), 'Who audits the policy?');

  assert.equal(answer.noEvidence, true);
  assert.equal(answer.text, NO_EVIDENCE_ANSWER);
  assert.deepEqual(answer.citations, []);
});

test('a citation the code cannot find in the passages cancels the answer', async () => {
  const services = citingBundle({
    draft: {
      text: 'According to the policy: "reviewed on 1 August 2026 and approved by C. Bernard"',
      citations: [citation({ quote: 'reviewed on 1 August 2026 and approved by C. Bernard' })]
    }
  });
  services.composer.compose = async () => ({
    text: 'According to the policy: "reviewed on 1 August 2026 and approved by C. Bernard"',
    citations: [citation({ evidenceId: 'ev-unknown', quote: QUOTE })]
  });

  const answer = await askQuestion(services, principal(), 'When was the policy reviewed?');
  assert.equal(answer.noEvidence, true, 'a citation to an unretrieved evidence cannot stand');
});

test('R13: a RESTRICTED evidence is invisible to an EXECUTIVE and the refusal is journalled', async () => {
  const services = fakeServices({
    passages: [
      passage({ evidenceId: 'ev-hr', accessLevel: 'RESTRICTED', text: 'The payroll restore test took 12 minutes.' }),
      passage()
    ],
    draft: {
      text: 'According to "Information security policy", page 1: "reviewed on 1 August 2026 and approved by C. Bernard"',
      citations: [citation({ quote: QUOTE })]
    }
  });

  const answer = await askQuestion(services, principal({ role: 'EXECUTIVE', clearance: 'INTERNAL' }), 'restore test');

  assert.equal(answer.citations.some((item) => item.evidenceId === 'ev-hr'), false);
  assert.equal(answer.passagesUsed, 1, 'the restricted passage is not even used');
  const denials = services.events('ACCESS_DENIED');
  assert.equal(denials.length, 1);
  assert.equal(denials[0]?.objectId, 'ev-hr');
  assert.equal(denials[0]?.detail.role, 'EXECUTIVE');
});

test('a principal cleared for RESTRICTED sees the social evidence (EF-QR-03)', async () => {
  const services = fakeServices({
    passages: [passage({ evidenceId: 'ev-hr', accessLevel: 'RESTRICTED', text: 'The payroll restore test took 12 minutes.' })],
    draft: {
      text: 'According to "Information security policy", page 1: "the payroll restore test took 12 minutes"',
      citations: [citation({ evidenceId: 'ev-hr', quote: 'the payroll restore test took 12 minutes' })]
    }
  });

  const answer = await askQuestion(services, principal({ role: 'QUALITY_LEAD', clearance: 'RESTRICTED' }), 'restore test');

  assert.equal(answer.noEvidence, false);
  assert.equal(answer.citations[0]?.evidenceId, 'ev-hr');
  assert.equal(services.events('ACCESS_DENIED').length, 0);
});

test('personal data in the rendered answer and in the quote is masked (ENF-CONF-02)', async () => {
  const services = fakeServices({
    passages: [passage({ text: 'The policy owner is camille.roy@msp.demo and the review is annual.' })],
    draft: {
      text: 'According to "Information security policy", page 1: "The policy owner is camille.roy@msp.demo and the review is annual."',
      citations: [citation({ quote: 'The policy owner is camille.roy@msp.demo and the review is annual.' })]
    }
  });

  const answer = await askQuestion(services, principal(), 'Who owns the policy?');

  assert.equal(answer.noEvidence, false);
  assert.equal(answer.redacted, true);
  assert.equal(answer.text.includes('camille.roy@msp.demo'), false);
  assert.equal(answer.citations[0]?.quote.includes('camille.roy@msp.demo'), false);
});

test('a control owner only reads the evidence of the controls they own (ENF-CONF-01)', async () => {
  const services = fakeServices({
    passages: [
      passage({ evidenceId: 'ev-mine' }),
      passage({ evidenceId: 'ev-other' })
    ],
    draft: { text: 'no answer', citations: [] }
  });
  await services.state.putAttachment({
    id: 'at-mine',
    evidenceId: 'ev-mine',
    controlId: 'CONT-01',
    frameworkId: 'demo-msp',
    supports: true,
    confidence: 0.9,
    quote: 'reviewed on 1 August 2026',
    quoteLocation: { page: 1 },
    reason: 'scripted',
    status: 'APPLIED',
    citationVerified: true,
    autoApplied: true,
    model: 'fake-reasoner',
    createdAt: '2026-11-11T12:00:00.000Z'
  });

  const owner = principal({ role: 'CONTROL_OWNER', ownedControls: ['CONT-01'] });
  const answer = await askQuestion(services, owner, 'policy');

  assert.equal(answer.passagesUsed, 1, 'the evidence of another control is not read');
  const denials = services.events('ACCESS_DENIED');
  assert.equal(denials.length, 1);
  assert.equal(denials[0]?.objectId, 'ev-other');
  assert.equal(denials[0]?.detail.reason, 'NOT_CONTROL_OWNER');
});

test('an empty question is refused', async () => {
  const services = citingBundle();
  await assert.rejects(() => askQuestion(services, principal(), '   '), { code: 'BAD_REQUEST' });
});
