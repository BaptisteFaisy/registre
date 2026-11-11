/**
 * Attachment prompt — EF-RAT-01/EF-RAT-02, Annex C output shape.
 *
 * The model receives one evidence and a short list of candidate controls, and
 * must return, for each candidate: supports / confidence / literal quote /
 * justification. Two rules are stated explicitly because they are the ones a
 * model breaks by default:
 *  - never invent a quote, copy a passage that exists in the document;
 *  - never decide the status, the state or the expiry: code does that.
 *
 * Pure functions, no I/O.
 */

import type { ControlCandidate } from '../../ports/index.ts';
import type { EvidenceFields } from '../../domain/types.ts';
import { UNTRUSTED_NOTICE, wrapUntrusted } from './injection.ts';

/** Annex C keys the model must return, in order. */
export const ATTACHMENT_OUTPUT_KEYS = [
  'controlId',
  'supports',
  'confidence',
  'quote',
  'page',
  'reason'
] as const;

/** The strict JSON contract repeated in every attachment prompt. */
export const ATTACHMENT_JSON_CONTRACT = [
  'Return one JSON array and nothing else: no prose, no markdown fence.',
  'Each element is an object with exactly these keys:',
  '{"controlId": string, "supports": boolean, "confidence": number between 0 and 1,',
  '"quote": string copied from the document, "page": integer or null, "reason": string}.',
  'One element per candidate control, in the order given.',
  'A candidate the evidence does not support gets "supports": false and an empty quote.',
  'The quote must be a literal passage of the document, at least 8 characters long.',
  'Never invent, paraphrase or translate a quote; a quote that is not in the document',
  'cancels the attachment.',
  'Do not output status, dates, control states or counts: code computes them.'
].join(' ');

/** Renders the candidate list as a stable, compact block. */
export function renderCandidates(candidates: readonly ControlCandidate[]): string {
  if (candidates.length === 0) return 'No candidate control was retrieved.';
  const lines = candidates.map((candidate, index) => {
    const control = candidate.control;
    return [
      `${index + 1}. id=${control.id} framework=${control.frameworkId} domain=${control.domain}`,
      `   title: ${control.title}`,
      `   requirement: ${control.requirement}`,
      `   expected evidence: ${control.expectedEvidence.join('; ') || 'not specified'}`,
      `   retrieval score: ${candidate.score.toFixed(3)} (${candidate.matchedOn})`
    ].join('\n');
  });
  return lines.join('\n');
}

/** Renders the Annex B fields already extracted, for context. */
export function renderFields(fields: EvidenceFields): string {
  return [
    `type: ${fields.type ?? 'unknown'}`,
    `title: ${fields.title ?? 'unknown'}`,
    `document date: ${fields.documentDate ?? 'unknown'}`,
    `period: ${fields.period.start ?? '?'} .. ${fields.period.end ?? '?'}`,
    `author: ${fields.author ?? 'unknown'}`,
    `approver: ${fields.approver ?? 'unknown'}`,
    `client: ${fields.client ?? 'internal'}`,
    `summary: ${fields.summary ?? 'unknown'}`
  ].join('\n');
}

export interface AttachmentPromptInput {
  evidenceId: string;
  fields: EvidenceFields;
  /** Full document text; fenced as untrusted data. */
  text: string;
  candidates: readonly ControlCandidate[];
}

/**
 * Long, repeated prefix of the attachment task (EF-RAT-01).
 *
 * The candidate catalogue is identical for every evidence of a batch, so it is
 * the prompt-cache prefix: the Bedrock adapter sends it as a system block
 * followed by a cache point (ENF-COUT-01), and the per-evidence block follows.
 */
export function attachmentPreamble(candidates: readonly ControlCandidate[]): string {
  return [
    'You attach audit evidence to the controls it supports.',
    UNTRUSTED_NOTICE,
    '',
    'Candidate controls:',
    renderCandidates(candidates),
    '',
    ATTACHMENT_JSON_CONTRACT
  ].join('\n');
}

export interface AttachmentEvidenceInput {
  evidenceId: string;
  fields: EvidenceFields;
  text: string;
}

/** Per-evidence part of the attachment task, sent after the cached prefix. */
export function attachmentEvidenceBlock(input: AttachmentEvidenceInput): string {
  return [
    `Evidence id: ${input.evidenceId}`,
    'Fields already extracted from the document:',
    renderFields(input.fields),
    '',
    'Evidence text:',
    wrapUntrusted(input.text, `evidence ${input.evidenceId}`)
  ].join('\n');
}

/**
 * Builds the whole attachment prompt (EF-RAT-01, EF-RAT-02, ENF-IA-03).
 * Deterministic: same input, same string. It is the concatenation the Bedrock
 * adapter splits into a cached system prefix and a user block.
 */
export function attachmentPrompt(input: AttachmentPromptInput): string {
  return [attachmentPreamble(input.candidates), '', attachmentEvidenceBlock(input)].join('\n');
}
