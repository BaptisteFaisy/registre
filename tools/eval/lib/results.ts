/**
 * Shape of a run result file — the input of the local scorer.
 *
 * The demo (`npm run demo`) and a real Bedrock run write the same document, so
 * the four measures of chapter 13.5 are computed by one code path whatever
 * produced the results.
 */

import type { AccessLevel } from '../../../src/domain/types.ts';
import type { ReadingFields, ReadingFlags } from './schema.ts';

export interface ReadingResult {
  evidenceId: string;
  /** Fields returned by the reader; `null` when nothing could be read. */
  fields: Partial<ReadingFields> | null;
  flags?: Partial<ReadingFlags>;
  accessLevel?: AccessLevel | null;
}

export interface AttachmentResultItem {
  controlId: string;
  supports: boolean;
  confidence: number;
  quote?: string;
  /** Set by code when the quote was searched in the evidence text (Annex C). */
  citationVerified?: boolean;
}

export interface AttachmentResult {
  evidenceId: string;
  attachments: AttachmentResultItem[];
}

export interface SufficiencyResult {
  evidenceId: string;
  controlId: string;
  /** Elements the reviewer was told are missing. */
  missing: string[];
  elements?: Array<{ expected: string; present: boolean }>;
}

export interface AnswerResult {
  questionId: string;
  answerKind: 'EVIDENCE' | 'NO_EVIDENCE';
  citations: Array<{ evidenceId: string; quote?: string; page?: number | null }>;
}

/** One run of the pipeline, reduced to what the measures need. */
export interface RunResults {
  runId: string;
  /** `demo`, `bedrock`, `fixture` … free text, shown in the report. */
  producedBy: string;
  generatedAt?: string;
  reading: ReadingResult[];
  attachment: AttachmentResult[];
  sufficiency: SufficiencyResult[];
  answers: AnswerResult[];
}

function arrayOf<T>(value: unknown, key: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`results.${key} must be an array`);
  return value as T[];
}

/** Validates the envelope of a results document and fills the empty sections. */
export function parseRunResults(value: unknown): RunResults {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('results file must contain a JSON object');
  }
  const source = value as Record<string, unknown>;
  return {
    runId: typeof source.runId === 'string' ? source.runId : 'unnamed-run',
    producedBy: typeof source.producedBy === 'string' ? source.producedBy : 'unknown',
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : undefined,
    reading: arrayOf<ReadingResult>(source.reading, 'reading'),
    attachment: arrayOf<AttachmentResult>(source.attachment, 'attachment'),
    sufficiency: arrayOf<SufficiencyResult>(source.sufficiency, 'sufficiency'),
    answers: arrayOf<AnswerResult>(source.answers, 'answers')
  };
}

/** Section sizes, for the report header. */
export function resultCounts(results: RunResults): Record<string, number> {
  return {
    reading: results.reading.length,
    attachment: results.attachment.length,
    sufficiency: results.sufficiency.length,
    answers: results.answers.length
  };
}
