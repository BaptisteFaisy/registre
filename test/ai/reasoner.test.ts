/**
 * Request building of the Bedrock adapters, checked without AWS: Flex tier
 * (ENF-COUT-01), prompt-cache point on the long candidate prefix, structured
 * output, and the no-evidence shortcut (EF-RAT-01, EF-QR-01/02).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredConverseInput } from '../../src/ai/bedrock/structuredReasoner.ts';
import { answerConverseInput, createComposer } from '../../src/ai/bedrock/composer.ts';
import { createMockAi } from '../../src/ai/mock/index.ts';
import { ATTACHMENT_JSON_SCHEMA, SUFFICIENCY_JSON_SCHEMA, parseAttachmentProposals } from '../../src/ai/schemas.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import type { Passage } from '../../src/domain/types.ts';
import { makeControl, makeFields, makePages, makeSettings } from '../fixtures/builders.ts';

const REQUEST = {
  prompt: 'prompt body',
  schema: ATTACHMENT_JSON_SCHEMA,
  schemaName: 'attachment_proposals',
  cacheablePrefix: '30 candidate controls follow.'
};

const PASSAGE: Passage = {
  evidenceId: 'ev-1',
  title: 'Restoration report',
  documentDate: '2026-10-14',
  page: 2,
  text: 'Restoration took 42 minutes.',
  score: 0.8,
  accessLevel: 'INTERNAL'
};

test('the nightly batch uses the Flex service tier', () => {
  const input = structuredConverseInput(REQUEST, { modelId: 'anthropic.sonnet', tier: 'FLEX' });
  assert.deepEqual(input.serviceTier, { type: 'flex' });
  const standard = structuredConverseInput(REQUEST, { modelId: 'anthropic.sonnet', tier: 'STANDARD' });
  assert.equal(standard.serviceTier, undefined);
});

test('a cache point closes the long, repeated candidate prefix', () => {
  const input = structuredConverseInput(REQUEST, { modelId: 'anthropic.sonnet', tier: 'FLEX' });
  const system = input.system ?? [];
  assert.equal(system.length, 3);
  assert.ok('text' in system[1]! && (system[1] as { text: string }).text.includes('candidate controls'));
  assert.deepEqual(system[2], { cachePoint: { type: 'default' } });
});

test('without a cacheable prefix no cache point is sent', () => {
  const input = structuredConverseInput({ ...REQUEST, cacheablePrefix: undefined }, { modelId: 'm', tier: 'FLEX' });
  assert.equal(input.system?.length, 1);
});

test('the structured request is deterministic and uses the JSON-schema output', () => {
  const input = structuredConverseInput(REQUEST, { modelId: 'anthropic.sonnet', tier: 'FLEX', maxTokens: 1024 });
  assert.equal(input.inferenceConfig?.temperature, 0);
  assert.equal(input.inferenceConfig?.maxTokens, 1024);
  assert.equal(input.outputConfig?.textFormat?.type, 'json_schema');
  const structure = input.outputConfig?.textFormat?.structure;
  assert.ok(structure && 'jsonSchema' in structure);
  assert.equal((structure as { jsonSchema: { name?: string } }).jsonSchema.name, 'attachment_proposals');
  assert.equal(input.messages?.length, 1);
});

test('the sufficiency request uses the Annex D schema', () => {
  const input = structuredConverseInput(
    { prompt: 'p', schema: SUFFICIENCY_JSON_SCHEMA, schemaName: 'sufficiency_elements' },
    { modelId: 'm', tier: 'STANDARD' }
  );
  const structure = input.outputConfig?.textFormat?.structure as { jsonSchema: { schema: string } };
  assert.deepEqual(JSON.parse(structure.jsonSchema.schema).items.required, ['expected', 'present', 'quote']);
});

test('the answer request carries the passages and the structured citation shape', () => {
  const input = answerConverseInput({ question: 'How long did the restore take?', passages: [PASSAGE] }, { modelId: 'anthropic.sonnet' });
  assert.equal(input.inferenceConfig?.temperature, 0);
  const content = input.messages?.[0]?.content?.[0];
  assert.ok(content && 'text' in content);
  const prompt = (content as { text: string }).text;
  assert.ok(prompt.includes('Restoration took 42 minutes.'));
  assert.ok(prompt.includes('How long did the restore take?'));
  assert.ok(prompt.includes(NO_EVIDENCE_ANSWER));
});

test('a question without passage is answered without calling the model (EF-QR-02)', async () => {
  const composer = createComposer(makeSettings());
  const draft = await composer.compose({ question: 'How long did the restore take?', passages: [] });
  assert.equal(draft.text, NO_EVIDENCE_ANSWER);
  assert.deepEqual(draft.citations, []);
  assert.equal(draft.cost, undefined, 'no token was spent');
});

test('the reasoner never returns a control that was not proposed (EF-RAT-01)', async () => {
  const proposals = parseAttachmentProposals(
    [
      { controlId: 'CONT-01', supports: true, confidence: 0.9, quote: 'a real passage of the document', page: 1, reason: 'r' },
      { controlId: 'CONT-77', supports: true, confidence: 0.9, quote: 'another passage', page: 1, reason: 'r' }
    ],
    ['CONT-01']
  );
  assert.deepEqual(
    proposals.map((proposal) => proposal.controlId),
    ['CONT-01']
  );
});

test('the mock reasoner covers the expected items of the control it was given', async () => {
  const control = makeControl({ expectedEvidence: ['Test date', 'Recovery time'] });
  const elements = await createMockAi().reasoner.assessSufficiency({
    evidence: { id: 'ev-1', fields: makeFields(), textPages: makePages('A restore test happened on 14 October 2026.') },
    control
  });
  assert.deepEqual(
    elements.map((element) => element.expected),
    control.expectedEvidence
  );
});
