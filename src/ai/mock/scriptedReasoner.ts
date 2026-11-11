/**
 * Scripted `Reasoner` — the deterministic twin of the structured Bedrock call
 * (EF-RAT-01/02, EF-SUF-01).
 *
 * Two modes:
 *  1. SCRIPTED: a test or the demo provides, per evidence, the proposals and the
 *     sufficiency elements to return. Nothing is computed: the pipeline sees
 *     exactly the answer the scenario describes.
 *  2. HEURISTIC (fallback): proposals and elements are derived by token
 *     similarity between the evidence summary/text and the control requirement
 *     or expected item. Crude on purpose — it is a stand-in, and the quotes it
 *     returns are always real sentences of the document, so the code-side quote
 *     check still behaves like production.
 *
 * The mock never invents a state, a date or a count (ENF-IA-04).
 */

import type { AttachmentRequest, ProposedAttachment, Reasoner } from '../../ports/index.ts';
import type { Control, Evidence, SufficiencyElement } from '../../domain/types.ts';
import { similarity } from '../../support/normalize.ts';
import { bestSentence } from '../textMatch.ts';
import type { VersionedAttachmentProposal } from '../versioning.ts';
import { stampAttachmentVersion } from '../versioning.ts';

/** Minimum similarity for the heuristic to claim support. */
export const ATTACH_MIN_SCORE = 0.12;

/** Minimum similarity for the heuristic to declare an expected item present. */
export const ELEMENT_MIN_SCORE = 0.2;

/** Scripted answers, keyed by evidence id (attachments) or `ev|control`. */
export interface ReasonerScript {
  attachments?: ReadonlyMap<string, readonly ProposedAttachment[]>;
  sufficiency?: ReadonlyMap<string, readonly SufficiencyElement[]>;
}

/** Rounded confidence derived from a similarity score, capped below certainty. */
export function confidenceFrom(score: number): number {
  return Math.min(0.99, Math.round((0.25 + 1.5 * score) * 1000) / 1000);
}

/** Text used to characterise an evidence (summary, then title, then body). */
export function evidenceSearchText(evidence: Pick<Evidence, 'fields' | 'textPages'>): string {
  const summary = evidence.fields.summary ?? '';
  const title = evidence.fields.title ?? '';
  const body = evidence.textPages.map((page) => page.text).join('\n');
  return [summary, title, body].filter(Boolean).join('\n');
}

/** Heuristic proposals for one evidence (EF-RAT-01), deterministic. */
export function heuristicProposals(
  evidence: Pick<Evidence, 'id' | 'fields' | 'textPages'>,
  candidates: readonly { control: Control }[]
): ProposedAttachment[] {
  const text = evidenceSearchText(evidence);
  return candidates.map(({ control }) => {
    const target = `${control.title} ${control.requirement} ${control.expectedEvidence.join(' ')}`;
    const score = similarity(text, target);
    const best = bestSentence(text, target);
    const supports = score >= ATTACH_MIN_SCORE && best !== null;
    return {
      controlId: control.id,
      supports,
      confidence: supports ? confidenceFrom(score) : Math.min(0.3, confidenceFrom(score)),
      quote: supports && best ? best.sentence : '',
      page: null,
      reason: supports
        ? `The document shares ${Math.round(score * 100)}% of its vocabulary with the control requirement (offline heuristic).`
        : 'No passage of the document matches the control requirement (offline heuristic).'
    };
  });
}

/** Heuristic element check for one control (EF-SUF-01), deterministic. */
export function heuristicElements(
  evidence: Pick<Evidence, 'fields' | 'textPages'>,
  control: Control
): SufficiencyElement[] {
  const text = evidence.textPages.map((page) => page.text).join('\n');
  return control.expectedEvidence.map((expected) => {
    const best = bestSentence(text, expected);
    const present = best !== null && best.score >= ELEMENT_MIN_SCORE;
    return { expected, present, quote: present && best ? best.sentence : null };
  });
}

/**
 * Reasoner driven by a script, with a similarity fallback (EF-RAT-01, EF-SUF-01).
 * The same instance is used by the demo, so a scenario file drives the run.
 */
export class ScriptedReasoner implements Reasoner {
  readonly id = 'mock-scripted-reasoner';
  private readonly script: ReasonerScript;

  constructor(script: ReasonerScript = {}) {
    this.script = script;
  }

  /** Annex C proposals, from the script or from the heuristic (EF-RAT-01). */
  async proposeAttachments(request: AttachmentRequest): Promise<VersionedAttachmentProposal[]> {
    const scripted = this.script.attachments?.get(request.evidence.id);
    const proposals = scripted ?? heuristicProposals(request.evidence, request.candidates);
    return proposals.map(stampAttachmentVersion);
  }

  /** Annex D elements, from the script or from the heuristic (EF-SUF-01). */
  async assessSufficiency(input: {
    evidence: Pick<Evidence, 'id' | 'fields' | 'textPages'>;
    control: Control;
  }): Promise<SufficiencyElement[]> {
    const keyed = this.script.sufficiency?.get(`${input.evidence.id}|${input.control.id}`);
    const fallback = this.script.sufficiency?.get(`${input.evidence.id}|*`);
    const scripted = keyed ?? fallback;
    if (scripted) return scripted.map((element) => ({ ...element }));
    return heuristicElements(input.evidence, input.control);
  }
}

/** Factory used by `createMockAi` (EF-RAT-01). */
export function createScriptedReasoner(script: ReasonerScript = {}): Reasoner {
  return new ScriptedReasoner(script);
}
