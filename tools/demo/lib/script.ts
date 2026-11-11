import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE, findControl } from '../../../eval/catalogue.ts';
import { splitHeader } from '../../../src/ai/mock/scriptedReader.ts';
import { bestSentence } from '../../../src/ai/textMatch.ts';
import type { ReasonerScript } from '../../../src/ai/mock/scriptedReasoner.ts';
import type { ProposedAttachment } from '../../../src/ports/index.ts';
import type { SufficiencyElement } from '../../../src/domain/types.ts';
import { evidenceId } from '../../../src/support/ids.ts';
import { sha256Bytes } from '../../../src/support/hash.ts';
import { EVIDENCE_DIR } from '../generate.ts';

/** Confidence above the default 0.85 threshold: the attachment is applied. */
export const SCRIPTED_CONFIDENCE = 0.93;

/**
 * Confidence below the threshold: the attachment waits for a human decision
 * (EF-RAT-03). Every fifth document of the set is scripted this way, so the
 * demo shows a real validation queue and the effect of a decision on the states.
 */
export const REVIEW_CONFIDENCE = 0.72;

/** One document out of this many is sent to the validation queue. */
export const REVIEW_SAMPLE_EVERY = 5;

export function demoEvidenceId(bytes: Uint8Array): string {
  return evidenceId(sha256Bytes(bytes));
}

export function searchableText(raw: string, csv: boolean): string {
  return csv ? raw : splitHeader(raw).body;
}

export function buildReasonerScript(rootDir: string, isCsv: (fileName: string) => boolean): ReasonerScript {
  const attachments = new Map<string, readonly ProposedAttachment[]>();
  const sufficiency = new Map<string, readonly SufficiencyElement[]>();

  for (const [index, item] of EVIDENCE.entries()) {
    const bytes = readFileSync(join(rootDir, EVIDENCE_DIR, item.fileName));
    const raw = new TextDecoder().decode(bytes);
    const text = searchableText(raw, isCsv(item.fileName));
    const id = demoEvidenceId(bytes);

    if (item.expectedControls.length === 0) {
      attachments.set(id, []);
      continue;
    }
    const needsReview = index % REVIEW_SAMPLE_EVERY === 0;
    attachments.set(id, proposalsFor(item.id, text, item.expectedControls, needsReview));
    for (const controlId of item.expectedControls) {
      const elements = elementsFor(text, controlId, item.missingElements);
      if (elements) sufficiency.set(`${id}|${controlId}`, elements);
    }
  }
  return { attachments, sufficiency };
}

function proposalsFor(
  evidenceRef: string,
  text: string,
  controlIds: readonly string[],
  needsReview: boolean
): ProposedAttachment[] {
  const out: ProposedAttachment[] = [];
  for (const [position, controlId] of controlIds.entries()) {
    const control = findControl(controlId);
    if (!control) continue;
    const match = bestSentence(text, `${control.title} ${control.requirement}`);
    out.push({
      controlId,
      supports: true,
      // Only the first control of a sampled document is sent for review.
      confidence: needsReview && position === 0 ? REVIEW_CONFIDENCE : SCRIPTED_CONFIDENCE,
      quote: match?.sentence ?? '',
      page: 1,
      reason: `Catalogue of the demonstration set: ${evidenceRef} supports ${controlId}.`
    });
  }
  return out;
}

function elementsFor(
  text: string,
  controlId: string,
  gaps: readonly { controlId: string; expected: string }[]
): SufficiencyElement[] | null {
  const control = findControl(controlId);
  if (!control) return null;
  const missing = new Set(
    gaps.filter((gap) => gap.controlId === controlId).map((gap) => gap.expected.toLowerCase())
  );
  return control.expectedEvidence.map((expected) => {
    if (missing.has(expected.toLowerCase())) return { expected, present: false, quote: null };
    const match = bestSentence(text, expected);
    return match ? { expected, present: true, quote: match.sentence } : { expected, present: false, quote: null };
  });
}
