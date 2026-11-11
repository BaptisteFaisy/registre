/**
 * Bedrock evaluation task payloads: dataset shapes, judge metrics and job
 * configuration. No network: everything is built in memory and asserted as JSON.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE, QUESTIONS } from '../../eval/catalogue.ts';
import {
  KNOWLEDGE_BASE_METRICS,
  attachmentDataset,
  attachmentPrompt,
  controlCatalogueText,
  evalConfig,
  judgeMetrics,
  qaDataset,
  questionReference
} from '../../tools/eval/lib/bedrock.ts';
import { knowledgeBasePayload, modelJudgePayload } from '../../tools/eval/lib/bedrockConfigs.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';

const MODEL = 'anthropic.:0';
const KB_ID = 'kb-demo';

test('the judge dataset has one line per evidence, prompt and reference answer', () => {
  const rows = attachmentDataset();
  assert.equal(rows.length, EVIDENCE.length);
  for (const [index, row] of rows.entries()) {
    assert.ok(row.prompt.includes(EVIDENCE[index]?.title ?? ''), `prompt ${index}`);
    assert.ok(row.prompt.includes('Framework controls:'), `prompt ${index} carries the framework block`);
    assert.deepEqual(JSON.parse(row.referenceResponse), EVIDENCE[index]?.expectedControls);
  }
});

test('the framework block lists the thirty controls once', () => {
  const block = controlCatalogueText();
  for (let index = 1; index <= 30; index += 1) {
    const id = `CONT-${String(index).padStart(2, '0')}`;
    assert.equal(block.split(id).length - 1, 1, id);
  }
});

test('an evidence with text keeps it inside the prompt, capped', () => {
  const item = EVIDENCE[0];
  assert.ok(item !== undefined);
  const prompt = attachmentPrompt(item, 'x'.repeat(500));
  assert.ok(prompt.length > 2000, 'the prompt carries the framework block plus the evidence');
  assert.ok(prompt.includes('text:'));
});

test('the unrelated evidence gets an empty reference answer (R10)', () => {
  const item = EVIDENCE.find((candidate) => candidate.expectedControls.length === 0);
  assert.ok(item !== undefined);
  assert.equal(JSON.stringify(item.expectedControls), '[]');
  const row = attachmentDataset().find((candidate) => candidate.prompt.includes(item.title));
  assert.equal(row?.referenceResponse, '[]');
});

test('the two judge metrics are binary and forbid a wrong high-confidence link', () => {
  const metrics = judgeMetrics();
  assert.deepEqual(metrics.map((metric) => metric.metricName), ['attachment_set_matches', 'attachment_quote_grounded']);
  for (const metric of metrics) {
    assert.equal(metric.ratingMethod, 'BINARY');
    assert.equal(metric.scaleDefinitions.length, 2);
    assert.ok(metric.instructions.length > 100, metric.metricName);
  }
  assert.match(metrics[0]?.instructions ?? '', /Rate 0 when an id is missing/);
});

test('the knowledge base dataset follows the conversation turn shape', () => {
  const rows = qaDataset();
  assert.equal(rows.length, QUESTIONS.length);
  for (const [index, row] of rows.entries()) {
    const turn = row.conversationTurns[0];
    assert.ok(turn !== undefined);
    assert.equal(turn.prompt.content[0]?.text, QUESTIONS[index]?.question);
    assert.equal(turn.referenceResponses[0]?.text.length !== 0, true);
  }
});

test('the five trap questions expect the refusal sentence', () => {
  const traps = QUESTIONS.filter((question) => question.expectedAnswerKind === 'NO_EVIDENCE');
  assert.equal(traps.length, 5);
  for (const trap of traps) {
    assert.equal(questionReference(trap), NO_EVIDENCE_ANSWER);
    const row = qaDataset().find((candidate) => candidate.conversationTurns[0]?.prompt.content[0]?.text === trap.question);
    assert.equal(row?.conversationTurns[0]?.referenceResponses[0]?.text, NO_EVIDENCE_ANSWER);
  }
});

test('an answered question names the evidence, its file and its date', () => {
  const question = QUESTIONS.find((candidate) => candidate.expectedAnswerKind === 'EVIDENCE');
  assert.ok(question !== undefined);
  const reference = questionReference(question);
  const item = EVIDENCE.find((candidate) => candidate.id === question.expectedEvidenceIds[0]);
  assert.ok(reference.includes(item?.fileName ?? ''));
  assert.ok(reference.includes(item?.documentDate ?? ''));
});

test('the evaluation config names both tasks, their datasets and their metrics', () => {
  const config = evalConfig(MODEL, KB_ID);
  assert.deepEqual(config.counts, { evidence: 60, controls: 30, questions: 25, trapQuestions: 5 });
  assert.deepEqual(config.tasks.map((task) => task.kind), ['model-as-judge', 'knowledge-base']);
  assert.equal(config.tasks[0]?.dataset, 'attachment-dataset.jsonl');
  assert.equal(config.tasks[1]?.dataset, 'qa-dataset.jsonl');
  assert.deepEqual(config.tasks[1]?.metrics, [...KNOWLEDGE_BASE_METRICS]);
  assert.equal(config.tasks[1]?.knowledgeBaseId, KB_ID);
  assert.equal(config.cli.length, 3);
});

test('the job payloads point at the datasets and carry no secret', () => {
  const judge = modelJudgePayload(MODEL, judgeMetrics()) as Record<string, unknown>;
  const kb = knowledgeBasePayload(MODEL, KB_ID, KNOWLEDGE_BASE_METRICS) as Record<string, unknown>;
  const judgeText = JSON.stringify(judge);
  const kbText = JSON.stringify(kb);
  assert.match(judgeText, /attachment-dataset\.jsonl/);
  assert.match(kbText, /qa-dataset\.jsonl/);
  assert.match(judgeText, /attachment_set_matches/);
  assert.match(kbText, /kb-demo/);
  assert.doesNotMatch(judgeText, /AKIA|aws_secret/);
  assert.match(judgeText, /<BEDROCK_EVALUATION_ROLE_ARN>/, 'the role is a placeholder a human fills in');
});

test('no prompt or reference answer uses the forbidden wording', () => {
  const texts = [
    controlCatalogueText(),
    ...attachmentDataset().flatMap((row) => [row.prompt, row.referenceResponse]),
    ...qaDataset().map((row) => row.conversationTurns[0]?.referenceResponses[0]?.text ?? '')
  ];
  for (const text of texts) assert.equal(containsForbiddenWord(text), false, text.slice(0, 80));
});
