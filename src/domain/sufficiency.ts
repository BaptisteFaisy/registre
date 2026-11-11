/**
 * Sufficiency — EF-SUF-01 and EF-SUF-02 (spec 13.3, annex D).
 *
 * "Le modèle dit, élément par élément, s'il est présent, avec la citation.
 *  Le code en déduit : complète si tout est présent, partielle sinon, à
 *  vérifier si la confiance est basse." (ENF-IA-04)
 */

import type {
  Attachment,
  Sufficiency,
  SufficiencyClass,
  SufficiencyElement
} from './types.ts';
import { sufficiencyId } from '../support/ids.ts';

/** Below this confidence the verdict is TO_VERIFY, never COMPLETE (EF-SUF-02). */
export const LOW_CONFIDENCE = 0.6;

/** `class` and `missing` as computed by code. */
export interface SufficiencyVerdict {
  class: SufficiencyClass;
  missing: string[];
}

/** True when an element is declared present AND backed by a quote — EF-SUF-01. */
export function isElementSupported(element: SufficiencyElement): boolean {
  if (!element.present) return false;
  return typeof element.quote === 'string' && element.quote.trim().length > 0;
}

/** Lists the expected elements the evidence does not carry — EF-SUF-01. */
export function missingElements(elements: readonly SufficiencyElement[]): string[] {
  return elements.filter((element) => !isElementSupported(element)).map((element) => element.expected);
}

/**
 * Computes the sufficiency class from element-by-element findings — EF-SUF-02.
 * Never returns a "complete" verdict when one expected element is missing.
 */
export function computeSufficiencyClass(
  elements: readonly SufficiencyElement[],
  confidence = 1
): SufficiencyVerdict {
  if (elements.length === 0) return { class: 'TO_VERIFY', missing: [] };
  const missing = missingElements(elements);
  if (confidence < LOW_CONFIDENCE) return { class: 'TO_VERIFY', missing };
  if (missing.length === 0) return { class: 'COMPLETE', missing: [] };
  return { class: 'PARTIAL', missing };
}

/** Input needed to persist a sufficiency verdict. */
export interface SufficiencyInput {
  attachment: Pick<Attachment, 'id' | 'evidenceId' | 'controlId'>;
  elements: readonly SufficiencyElement[];
  /** Model confidence, 0..1; defaults to 1 (element findings trusted). */
  confidence?: number;
  now: string;
}

/** Assembles a persisted `Sufficiency` with code-computed class and missing — EF-SUF-01. */
export function buildSufficiency(input: SufficiencyInput): Sufficiency {
  const verdict = computeSufficiencyClass(input.elements, input.confidence ?? 1);
  return {
    id: sufficiencyId(input.attachment.id),
    attachmentId: input.attachment.id,
    evidenceId: input.attachment.evidenceId,
    controlId: input.attachment.controlId,
    elements: [...input.elements],
    class: verdict.class,
    missing: verdict.missing,
    computedAt: input.now
  };
}
