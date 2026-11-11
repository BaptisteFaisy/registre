/**
 * Answer prompt — EF-QR-01, EF-QR-02, ENF-IA-02.
 *
 * The answer is written only from the retrieved passages; each sentence that
 * asserts a fact must carry the passage it comes from, and the citation keeps
 * document, page and date. When no passage answers the question, the model must
 * answer exactly `NO_EVIDENCE_ANSWER` instead of inferring one.
 *
 * Pure functions, no I/O.
 */

import type { Passage } from '../../domain/types.ts';
import { NO_EVIDENCE_ANSWER } from '../../domain/types.ts';
import { excerpt } from '../../support/normalize.ts';
import { UNTRUSTED_NOTICE, wrapUntrusted } from './injection.ts';

/** Maximum characters of one passage sent to the model. */
export const PASSAGE_MAX_CHARS = 1200;

/** Keys of one citation object in the answer payload. */
export const ANSWER_CITATION_KEYS = ['evidenceId', 'quote', 'page'] as const;

/** The strict JSON contract of the answer prompt. */
export const ANSWER_JSON_CONTRACT = [
  'Return one JSON object and nothing else: no prose, no markdown fence.',
  'Shape: {"text": string, "citations": [{"evidenceId": string, "quote": string, "page": integer or null}]}.',
  'Write the answer only from the passages above; never add outside knowledge.',
  'Every factual sentence must be backed by one citation quoting the passage it uses.',
  'The quote of a citation is copied verbatim from the passage, at least 8 characters long.',
  `When no passage answers the question, set "text" to exactly: ${NO_EVIDENCE_ANSWER}`,
  'and return an empty citations array. Never guess an answer.',
  'Name the document, the page and the document date in the text when you cite.'
].join(' ');

/** Renders one passage with its provenance, fenced as untrusted data. */
export function renderPassage(passage: Passage, index: number): string {
  const header = [
    `passage ${index + 1}:`,
    `document: ${passage.title ?? 'untitled'}`,
    `document date: ${passage.documentDate ?? 'unknown'}`,
    `page: ${passage.page ?? 'unknown'}`,
    `relevance: ${passage.score.toFixed(3)}`
  ].join(' ');
  return [header, wrapUntrusted(excerpt(passage.text, PASSAGE_MAX_CHARS), `passage ${index + 1}`)].join('\n');
}

/** Renders every passage, in the order the retriever returned them. */
export function renderPassages(passages: readonly Passage[]): string {
  if (passages.length === 0) return 'No passage was retrieved.';
  return passages.map((passage, index) => renderPassage(passage, index)).join('\n\n');
}

export interface AnswerPromptInput {
  question: string;
  passages: readonly Passage[];
}

/**
 * Builds the question-answering prompt (EF-QR-01, EF-QR-02, ENF-IA-03).
 * Deterministic: same input, same string.
 */
export function answerPrompt(input: AnswerPromptInput): string {
  return [
    'You answer audit questions for an AWS MSP partner using only retrieved evidence.',
    UNTRUSTED_NOTICE,
    '',
    `Question: ${excerpt(input.question, 500)}`,
    '',
    'Retrieved passages:',
    renderPassages(input.passages),
    '',
    ANSWER_JSON_CONTRACT
  ].join('\n');
}
