/**
 * Question answering and cost reporting shapes.
 *
 * Extracted from `types.ts` to keep every file under the 500-line budget; the
 * entities are re-exported from `types.ts`, so consumers keep one import path.
 */

import type { AccessLevel, CostRecord, EvidenceId } from './types.ts';

/* ------------------------------------------------------------------- QA */

export interface Passage {
  evidenceId: EvidenceId;
  title: string | null;
  documentDate: string | null;
  page: number | null;
  text: string;
  score: number;
  accessLevel: AccessLevel;
}

export interface AnswerCitation {
  evidenceId: EvidenceId;
  title: string | null;
  page: number | null;
  documentDate: string | null;
  quote: string;
}

export interface Answer {
  question: string;
  text: string;
  citations: AnswerCitation[];
  /** True when the guardrail replaced an unanchored draft. */
  noEvidence: boolean;
  redacted: boolean;
  passagesUsed: number;
  cost?: CostRecord;
}

export const NO_EVIDENCE_ANSWER = 'No evidence answers this question.';


/* --------------------------------------------------------------- cost UI */

export interface CostReport {
  totalUsd: number;
  perEvidenceUsd: number;
  evidenceCount: number;
  bySource: Record<string, number>;
}
