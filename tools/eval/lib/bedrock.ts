/**
 * Payload builders for the two Bedrock evaluation tasks of spec 13.5.
 *
 *  - attachment: a model-as-judge task, dataset in the `prompt` +
 *    `referenceResponse` JSONL shape, graded by two custom metrics;
 *  - questions: a knowledge base evaluation, dataset in the
 *    `conversationTurns` JSONL shape, graded by the built-in metrics.
 *
 * Pure functions only: nothing here touches the network or the file system
 * except `readEvidenceText`, which reads a local file the caller points at.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_EVIDENCE_ANSWER } from '../../../src/domain/types.ts';
import { excerpt } from '../../../src/support/normalize.ts';
import type { CatalogueControl, CatalogueEvidence, CatalogueQuestion } from '../../../eval/catalogue.ts';
import { CONTROLS, DEMO_FRAMEWORK, EVIDENCE, QUESTIONS, findEvidence } from '../../../eval/catalogue.ts';

/** Character budget for the evidence body put inside a judge prompt. */
const PROMPT_TEXT_LIMIT = 1500;

/* ------------------------------------------------------------------ prompts */

/** The framework block; in production this is the cached prompt prefix. */
export function controlCatalogueText(controls: readonly CatalogueControl[] = CONTROLS): string {
  const lines = controls.map(
    (control) => `${control.id} — ${control.title}: ${control.requirement} Expected evidence: ${control.expectedEvidence.join('; ')}.`
  );
  return ['Framework controls:', ...lines].join('\n');
}

const INSTRUCTIONS = [
  'You review audit evidence for a managed service provider.',
  'Decide which controls of the framework the evidence supports.',
  'Answer with a JSON array of control ids and nothing else.',
  'Use [] when the evidence supports no control.'
].join(' ');

function evidenceBlock(item: CatalogueEvidence, text: string | null): string {
  const period = item.period === null ? 'none' : `${item.period.start ?? '?'} to ${item.period.end ?? '?'}`;
  return [
    'Evidence:',
    `file: ${item.fileName}`,
    `type: ${item.type}`,
    `title: ${item.title}`,
    `document date: ${item.documentDate}`,
    `period covered: ${period}`,
    `author: ${item.author ?? 'not stated'}`,
    `approver: ${item.approver ?? 'not signed'}`,
    `customer: ${item.client ?? 'internal'}`,
    `summary: ${item.summary}`,
    text === null ? 'text: not available' : `text:\n${text}`
  ].join('\n');
}

/** Prompt for one evidence: instructions, framework, then the evidence itself. */
export function attachmentPrompt(item: CatalogueEvidence, text: string | null = null): string {
  return [INSTRUCTIONS, '', controlCatalogueText(), '', evidenceBlock(item, text)].join('\n');
}

/** Reference answer: the expected control ids, as the model must return them. */
export function attachmentReference(item: CatalogueEvidence): string {
  return JSON.stringify(item.expectedControls);
}

export interface JudgeRow {
  prompt: string;
  referenceResponse: string;
}

/** One judge dataset line per evidence of the catalogue. */
export function attachmentDataset(texts: ReadonlyMap<string, string> = new Map()): JudgeRow[] {
  return EVIDENCE.map((item) => ({
    prompt: attachmentPrompt(item, texts.get(item.id) ?? null),
    referenceResponse: attachmentReference(item)
  }));
}

/* ------------------------------------------------------------------ metrics */

export interface CustomMetric {
  metricName: string;
  instructions: string;
  ratingMethod: 'BINARY' | 'FIVE_POINT_LIKERT';
  scaleDefinitions: Array<{ definition: string; rating: string }>;
}

/**
 * Custom metrics of the judge model. Both are binary so the score maps directly
 * onto the acceptance target "no evidence attached wrongly with high confidence".
 */
export function judgeMetrics(): CustomMetric[] {
  return [
    {
      metricName: 'attachment_set_matches',
      instructions: [
        'The prompt asks which framework controls one piece of evidence supports.',
        'The reference response is the accepted answer: a JSON array of control ids.',
        'The generated response is the answer to grade.',
        'Rate 1 when both arrays hold exactly the same ids, in any order.',
        'Rate 0 when an id is missing, an id is added, or the answer is not a JSON array.',
        'An added id claims support that does not exist: it is an error, not a detail.'
      ].join(' '),
      ratingMethod: 'BINARY',
      scaleDefinitions: [
        { definition: 'The generated set of control ids is exactly the reference set.', rating: '1' },
        { definition: 'The generated set differs from the reference set, or cannot be parsed.', rating: '0' }
      ]
    },
    {
      metricName: 'attachment_quote_grounded',
      instructions: [
        'A generated answer may carry a passage quoted from the evidence.',
        'Rate 1 when every quoted passage appears in the evidence text given in the prompt.',
        'Rate 0 when a quoted passage cannot be found there, or when the answer claims support without quoting anything.',
        'Ignore letter case and punctuation when comparing.'
      ].join(' '),
      ratingMethod: 'BINARY',
      scaleDefinitions: [
        { definition: 'Every quoted passage appears in the evidence text.', rating: '1' },
        { definition: 'A quoted passage is absent from the evidence text, or no quote backs the claim.', rating: '0' }
      ]
    }
  ];
}

/* --------------------------------------------------------- knowledge base */

export interface ConversationLine {
  conversationTurns: Array<{
    prompt: { content: Array<{ text: string }> };
    referenceResponses: Array<{ text: string }>;
  }>;
}

/** Reference answer of one question, built from the expected evidence. */
export function questionReference(question: CatalogueQuestion): string {
  if (question.expectedAnswerKind === 'NO_EVIDENCE') return NO_EVIDENCE_ANSWER;
  const parts = question.expectedEvidenceIds.map((evidenceId) => {
    const item = findEvidence(evidenceId);
    if (item === undefined) return evidenceId;
    return `${item.title} (${item.fileName}, dated ${item.documentDate}): ${excerpt(item.summary, 160)}`;
  });
  return parts.join(' ');
}

/** Knowledge base evaluation dataset: one conversation turn per question. */
export function qaDataset(questions: readonly CatalogueQuestion[] = QUESTIONS): ConversationLine[] {
  return questions.map((question) => ({
    conversationTurns: [
      {
        prompt: { content: [{ text: question.question }] },
        referenceResponses: [{ text: questionReference(question) }]
      }
    ]
  }));
}

/** Built-in metrics of a knowledge base evaluation job. */
export const KNOWLEDGE_BASE_METRICS: readonly string[] = ['Correctness', 'Completeness', 'Helpfulness', 'Faithfulness'] as const;

/* ------------------------------------------------------------------- config */

export interface EvalTaskDefinition {
  name: string;
  kind: 'model-as-judge' | 'knowledge-base';
  dataset: string;
  datasetFormat: string;
  metrics: string[];
  modelIdentifier: string;
  knowledgeBaseId?: string;
  notes: string;
}

export interface EvalConfig {
  framework: { id: string; version: string };
  counts: { evidence: number; controls: number; questions: number; trapQuestions: number };
  tasks: EvalTaskDefinition[];
  cli: string[];
}

/** The task definitions written next to the datasets. */
export function evalConfig(modelIdentifier: string, knowledgeBaseId: string): EvalConfig {
  return {
    framework: { id: DEMO_FRAMEWORK.id, version: DEMO_FRAMEWORK.version },
    counts: {
      evidence: EVIDENCE.length,
      controls: CONTROLS.length,
      questions: QUESTIONS.length,
      trapQuestions: QUESTIONS.filter((question) => question.expectedAnswerKind === 'NO_EVIDENCE').length
    },
    tasks: [
      {
        name: 'registre-attachment-judge',
        kind: 'model-as-judge',
        dataset: 'attachment-dataset.jsonl',
        datasetFormat: 'one JSON object per line: { "prompt": string, "referenceResponse": string }',
        metrics: judgeMetrics().map((metric) => metric.metricName),
        modelIdentifier,
        notes: 'metrics are defined in attachment-metrics.json; the dataset is regenerated from the catalogue'
      },
      {
        name: 'registre-qa-knowledge-base',
        kind: 'knowledge-base',
        dataset: 'qa-dataset.jsonl',
        datasetFormat: 'one JSON object per line: { "conversationTurns": [{ "prompt": { "content": [{ "text": string }] }, "referenceResponses": [{ "text": string }] }] }',
        metrics: [...KNOWLEDGE_BASE_METRICS],
        modelIdentifier,
        knowledgeBaseId,
        notes: 'the five trap questions expect the refusal sentence; any answer naming a document is a failure'
      }
    ],
    cli: [
      'aws bedrock create-evaluation-job --cli-input-json file://eval/bedrock/attachment-job.json',
      'aws bedrock create-evaluation-job --cli-input-json file://eval/bedrock/qa-job.json',
      'aws bedrock get-evaluation-job --job-identifier <job-arn>'
    ]
  };
}

/* --------------------------------------------------------------- text input */

/** Reads an evidence file as text when it is local, small and not binary. */
export function readEvidenceText(dir: string, fileName: string): string | null {
  const path = join(dir, fileName);
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  if (buffer.byteLength > 200_000 || buffer.includes(0)) return null;
  const text = buffer.toString('utf8').trim();
  return text.length === 0 ? null : text.slice(0, PROMPT_TEXT_LIMIT);
}

/** Maps each evidence id to the text found in `dir`, when the demo wrote it. */
export function loadEvidenceTexts(dir: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const item of EVIDENCE) {
    const text = readEvidenceText(dir, item.fileName);
    if (text !== null) texts.set(item.id, text);
  }
  return texts;
}
