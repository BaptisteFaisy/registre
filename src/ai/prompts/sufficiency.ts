/**
 * Sufficiency prompt — EF-SUF-01, Annex D output shape.
 *
 * The model answers one question per expected element: is it present, and with
 * which quote? It never decides the class (`COMPLETE` / `PARTIAL` /
 * `TO_VERIFY`) nor the `missing` list: both are computed by code from the
 * element flags (ENF-IA-04).
 *
 * Pure functions, no I/O.
 */

import type { Control } from '../../domain/types.ts';
import { UNTRUSTED_NOTICE, wrapUntrusted } from './injection.ts';

/** Annex D keys the model must return, in order. */
export const SUFFICIENCY_OUTPUT_KEYS = ['expected', 'present', 'quote'] as const;

/** The strict JSON contract repeated in every sufficiency prompt. */
export const SUFFICIENCY_JSON_CONTRACT = [
  'Return one JSON array and nothing else: no prose, no markdown fence.',
  'One element per expected item, in the order given, with exactly these keys:',
  '{"expected": string copied verbatim from the expected list,',
  '"present": boolean, "quote": string or null}.',
  'When present is true, quote is a literal passage of the document, at least 8 characters long.',
  'When present is false, quote is null.',
  'Never invent, paraphrase or translate a quote.',
  'Do not output a class, a missing list, a date or a count: code computes them.'
].join(' ');

/** Numbered expected-items block, verbatim from the control. */
export function renderExpected(control: Control): string {
  const items = control.expectedEvidence.map((item, index) => `${index + 1}. ${item}`);
  return items.length > 0 ? items.join('\n') : '1. (no expected item declared for this control)';
}

export interface SufficiencyPromptInput {
  evidenceId: string;
  control: Control;
  text: string;
}

/**
 * Control block of the sufficiency task (EF-SUF-01).
 * The same control is checked against many evidences in one batch, so this
 * block is the prompt-cache prefix of the Bedrock adapter (ENF-COUT-01).
 */
export function sufficiencyControlBlock(control: Control): string {
  return [
    'You check whether one piece of audit evidence contains what a control expects.',
    UNTRUSTED_NOTICE,
    '',
    `Control id: ${control.id} (framework ${control.frameworkId}, domain ${control.domain})`,
    `Control title: ${control.title}`,
    `Control requirement: ${control.requirement}`,
    '',
    'Expected items:',
    renderExpected(control),
    '',
    SUFFICIENCY_JSON_CONTRACT
  ].join('\n');
}

/** Per-evidence part of the sufficiency task, sent after the cached prefix. */
export function sufficiencyEvidenceBlock(input: { evidenceId: string; text: string }): string {
  return [`Evidence id: ${input.evidenceId}`, 'Evidence text:', wrapUntrusted(input.text, `evidence ${input.evidenceId}`)].join(
    '\n'
  );
}

/**
 * Builds the whole element-by-element sufficiency prompt (EF-SUF-01, ENF-IA-03).
 * Deterministic: same input, same string.
 */
export function sufficiencyPrompt(input: SufficiencyPromptInput): string {
  return [sufficiencyControlBlock(input.control), '', sufficiencyEvidenceBlock(input)].join('\n');
}
