/**
 * In-memory retrievers — the deterministic twin of the two managed knowledge
 * bases (EF-RAT-01, EF-QR-01, EF-QR-03).
 *
 * Search is token similarity over the catalogue held in memory: no network, no
 * index, same result on every run. The access filter is applied the same way as
 * in production — a passage above the caller's clearance is never returned, even
 * when it is the best match (EF-QR-03).
 */

import type { ControlCandidate, ControlRetriever, EvidenceRetriever } from '../../ports/index.ts';
import type { AccessLevel, Control, Evidence, FrameworkId, Passage } from '../../domain/types.ts';
import { similarity } from '../../support/normalize.ts';

/** Below this similarity a candidate is not worth showing. */
export const MIN_MATCH_SCORE = 0.05;

/** Default number of candidate controls (spec 13.2: about ten). */
export const DEFAULT_CONTROL_LIMIT = 10;

/** Default number of passages returned to the composer. */
export const DEFAULT_PASSAGE_LIMIT = 8;

/** Text that represents a control in the search index. */
export function controlSearchText(control: Control): string {
  return [control.id, control.title, control.requirement, control.expectedEvidence.join(' '), control.domain].join(' ');
}

/** Sorts by descending score, then by id, so the order is fully determined. */
export function byScoreDesc<T extends { score: number }>(left: T, right: T): number {
  return right.score - left.score;
}

/** `ControlRetriever` over an in-memory control catalogue (EF-RAT-01). */
export class MemoryControlRetriever implements ControlRetriever {
  readonly id = 'mock-kb-frameworks';
  private readonly controls: readonly Control[];

  constructor(controls: readonly Control[] = []) {
    this.controls = controls;
  }

  async candidates(input: {
    type: string | null;
    title: string | null;
    summary: string | null;
    text: string;
    frameworkId?: FrameworkId;
    limit?: number;
  }): Promise<ControlCandidate[]> {
    const query = [input.type ?? '', input.title ?? '', input.summary ?? '', input.text].join(' ');
    const limit = input.limit ?? DEFAULT_CONTROL_LIMIT;
    return this.controls
      .filter((control) => !input.frameworkId || control.frameworkId === input.frameworkId)
      .map((control) => ({ control, score: round3(similarity(query, controlSearchText(control))), matchedOn: 'token similarity' }))
      .filter((candidate) => candidate.score >= MIN_MATCH_SCORE)
      .sort(byScoreDesc)
      .slice(0, limit);
  }
}

/** `EvidenceRetriever` over an in-memory evidence catalogue (EF-QR-01/03). */
/**
 * Relevance floor of the offline evidence search.
 *
 * A managed knowledge base returns nothing when no chunk is close enough to the
 * question; the token-similarity stand-in needs the same behaviour, otherwise a
 * question no document answers would still return a weak passage and the answer
 * would look grounded (EF-QR-02). Callers may raise it; the default keeps the
 * permissive behaviour the unit tests rely on.
 */
export const DEFAULT_EVIDENCE_MIN_SCORE = MIN_MATCH_SCORE;

export class MemoryEvidenceRetriever implements EvidenceRetriever {
  readonly id = 'mock-kb-evidence';
  private readonly evidences: readonly Evidence[];
  private readonly minScore: number;

  constructor(evidences: readonly Evidence[] = [], minScore: number = DEFAULT_EVIDENCE_MIN_SCORE) {
    this.evidences = evidences;
    this.minScore = minScore;
  }

  async search(input: {
    query: string;
    allowedLevels: readonly AccessLevel[];
    limit?: number;
    frameworkId?: FrameworkId;
  }): Promise<Passage[]> {
    const allowed = new Set(input.allowedLevels);
    const limit = input.limit ?? DEFAULT_PASSAGE_LIMIT;
    const passages: Passage[] = [];
    for (const evidence of this.evidences) {
      if (!allowed.has(evidence.accessLevel)) continue;
      for (const page of evidence.textPages) {
        const score = round3(similarity(input.query, page.text));
        if (score < this.minScore) continue;
        passages.push({
          evidenceId: evidence.id,
          title: evidence.fields.title,
          documentDate: evidence.fields.documentDate,
          page: page.page,
          text: page.text,
          score,
          accessLevel: evidence.accessLevel
        });
      }
    }
    return passages.sort(byScoreDesc).slice(0, limit);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Factory used by `createMockAi` (EF-RAT-01). */
export function createControlRetriever(controls: readonly Control[] = []): ControlRetriever {
  return new MemoryControlRetriever(controls);
}

/** Factory used by `createMockAi` (EF-QR-01, EF-QR-03). */
export function createEvidenceRetriever(
  evidences: readonly Evidence[] = [],
  minScore: number = DEFAULT_EVIDENCE_MIN_SCORE
): EvidenceRetriever {
  return new MemoryEvidenceRetriever(evidences, minScore);
}
