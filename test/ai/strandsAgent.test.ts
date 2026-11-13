/**
 * Strands auditor agent: the tools, the briefing, the composer contract and the
 * engine switch — everything verifiable without calling Bedrock (EF-QR-01,
 * EF-QR-02, EF-QR-03, ENF-IA-02, ENF-COUT-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Passage } from '../../src/domain/types.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { checkQuote, evidenceCards, readEvidence, searchPassages } from '../../src/ai/strands/tools.ts';
import {
  agentBriefing,
  createAnswerComposer,
  StrandsAnswerComposer
} from '../../src/ai/strands/auditorAgent.ts';
import type { AgentRunInput } from '../../src/ai/strands/auditorAgent.ts';
import { createCostMeter } from '../../src/ai/bedrock/costs.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { makeSettings } from '../fixtures/builders.ts';

const SETTINGS = makeSettings({ region: 'eu-central-1' });

function passage(evidenceId: string, page: number | null, text: string, title = 'Access review Q3'): Passage {
  return { evidenceId, title, documentDate: '2026-09-30', page, text, score: 0.8, accessLevel: 'INTERNAL' };
}

const PASSAGES: Passage[] = [
  passage('ev-1', 1, 'All user accounts were reviewed on 30 September and approved by the security officer.'),
  passage('ev-1', 2, 'Three dormant accounts were disabled during the review.'),
  passage('ev-2', 1, 'The backup restore test succeeded for every production database.', 'Restore test report')
];

test('EF-QR-03 the agent is briefed with ids, titles and dates, never with passage text', () => {
  const brief = agentBriefing('Were user accounts reviewed?', PASSAGES);
  assert.match(brief, /ev-1 · Access review Q3 · dated 2026-09-30 · pages 1, 2/);
  assert.match(brief, /ev-2 · Restore test report/);
  assert.doesNotMatch(brief, /dormant accounts/);
  assert.equal(evidenceCards(PASSAGES).length, 2);
});

test('EF-QR-01 search_passages ranks the allowed passages by shared terms', () => {
  const hits = searchPassages(PASSAGES, 'accounts reviewed security officer');
  assert.equal(hits[0]?.evidenceId, 'ev-1');
  assert.equal(hits[0]?.page, 1);
  assert.match(hits[0]?.excerpt ?? '', /^<<<document>>>/);
  assert.deepEqual(searchPassages(PASSAGES, 'a'), []);
});

test('EF-QR-01 read_evidence returns fenced pages, and nothing for an evidence outside the passages', () => {
  const read = readEvidence(PASSAGES, 'ev-1');
  assert.equal(read.found, true);
  assert.equal(read.pages.length, 2);
  assert.match(read.pages[1]?.text ?? '', /dormant accounts/);
  assert.deepEqual(readEvidence(PASSAGES, 'ev-restricted'), { found: false, pages: [] });
});

test('ENF-IA-02 check_quote confirms a verbatim quote and refuses an invented one', () => {
  const ok = checkQuote(PASSAGES, 'ev-1', 'approved by the security officer');
  assert.equal(ok.found, true);
  assert.equal(ok.page, 1);
  assert.equal(checkQuote(PASSAGES, 'ev-1', 'approved by the board of directors').found, false);
  assert.equal(checkQuote(PASSAGES, 'ev-restricted', 'approved by the security officer').found, false);
});

test('EF-QR-02 with no passage the agent is never called', async () => {
  let calls = 0;
  const composer = new StrandsAnswerComposer(SETTINGS, { runner: async () => { calls += 1; return { output: null, tokensIn: 0, tokensOut: 0 }; } });
  const draft = await composer.compose({ question: 'Anything?', passages: [] });
  assert.equal(draft.text, NO_EVIDENCE_ANSWER);
  assert.equal(calls, 0);
});

test('EF-QR-01 the structured answer keeps only citations of allowed evidences, and its cost is metered', async () => {
  const meter = createCostMeter();
  let seen: AgentRunInput | undefined;
  const composer = new StrandsAnswerComposer(SETTINGS, {
    meter,
    runner: async (input) => {
      seen = input;
      return {
        output: {
          text: 'User accounts were reviewed on 30 September 2026.',
          citations: [
            { evidenceId: 'ev-1', quote: 'approved by the security officer', page: 1 },
            { evidenceId: 'ev-restricted', quote: 'a quote from a document the reader may not see', page: 1 }
          ]
        },
        tokensIn: 1200,
        tokensOut: 150
      };
    }
  });
  const draft = await composer.compose({ question: 'Were user accounts reviewed?', passages: PASSAGES });
  assert.equal(seen?.region, 'eu-central-1');
  assert.equal(seen?.modelId, SETTINGS.answerModel);
  assert.deepEqual(draft.citations.map((citation) => citation.evidenceId), ['ev-1']);
  assert.equal(meter.report().count, 1);
  assert.equal(draft.cost?.source, 'strands-auditor-agent');
});

test('an agent failure surfaces as an upstream error, never as an invented answer', async () => {
  const composer = new StrandsAnswerComposer(SETTINGS, { runner: async () => { throw new Error('throttled'); } });
  await assert.rejects(composer.compose({ question: 'Q?', passages: PASSAGES }), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.match((error as Error).message, /Strands agent failed: throttled/);
    return true;
  });
});

test('the answer engine is the Strands agent unless REGISTRE_ANSWER_ENGINE=converse', () => {
  assert.equal(createAnswerComposer({}, SETTINGS).id, 'strands-auditor-agent');
  assert.equal(createAnswerComposer({ REGISTRE_ANSWER_ENGINE: 'converse' }, SETTINGS).id, 'bedrock-composer');
});
