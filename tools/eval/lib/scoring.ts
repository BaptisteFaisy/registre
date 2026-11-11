/**
 * The four measures of spec chapter 13.5, computed from the datasets and a run
 * result file. Pure functions: no I/O, so the tests can score a hand-built run.
 *
 * Targets (chapter 13.5):
 *   reading        > 90% of fields read correctly
 *   attachment     > 85% accepted without correction, no wrong high-confidence link
 *   sufficiency    every expected gap detected
 *   questions      > 90% correct citations, no invented answer on the five traps
 */

import { normalizeText } from '../../../src/support/normalize.ts';
import { isIsoDate, toDateOnly } from '../../../src/support/iso8601.ts';
import type { AttachmentRow, QaRow, ReadingRow, SufficiencyRow } from './schema.ts';
import type { AnswerResult, AttachmentResult, ReadingResult, RunResults, SufficiencyResult } from './results.ts';
import type { EvidenceTexts } from './quotes.ts';
import { quoteSupported } from './quotes.ts';

/** Ratio targets; a metric passes when strictly above its target. */
export const TARGETS = {
  readingAccuracy: 0.9,
  attachmentAcceptance: 0.85,
  citationAccuracy: 0.9
} as const;

/** Compared fields: the eleven of Annex B that carry a value, plus access and flags. */
export const SCORED_FIELDS: readonly string[] = [
  'type',
  'title',
  'documentDate',
  'period.start',
  'period.end',
  'version',
  'author',
  'approver',
  'approvalDate',
  'client',
  'personalData',
  'accessLevel',
  'unreadable',
  'dateToConfirm'
] as const;

export type FlatValue = string | boolean | null;

function flatten(value: Record<string, unknown> | null | undefined): Record<string, FlatValue> {
  if (value === null || value === undefined) return {};
  const out: Record<string, FlatValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') out[key] = entry;
  }
  return out;
}

function flattenPeriod(value: unknown): Record<string, FlatValue> {
  if (typeof value !== 'object' || value === null) return {};
  const period = value as Record<string, unknown>;
  return {
    'period.start': typeof period.start === 'string' ? period.start : null,
    'period.end': typeof period.end === 'string' ? period.end : null
  };
}

/** Flattens the expected side of a reading row into the scored field set. */
export function expectedFlat(row: ReadingRow): Record<string, FlatValue> {
  return {
    ...flatten(row.expectedFields as unknown as Record<string, unknown>),
    ...flattenPeriod(row.expectedFields.period),
    accessLevel: row.expectedAccessLevel,
    unreadable: row.expectedFlags.unreadable,
    dateToConfirm: row.expectedFlags.dateToConfirm
  };
}

/** Flattens the produced side of a reading result (missing fields become null). */
export function actualFlat(result: ReadingResult | undefined): Record<string, FlatValue> {
  const fields = result?.fields ?? null;
  return {
    ...flatten(fields as unknown as Record<string, unknown> | null),
    ...flattenPeriod(fields?.period),
    accessLevel: result?.accessLevel ?? null,
    unreadable: result?.flags?.unreadable ?? false,
    dateToConfirm: result?.flags?.dateToConfirm ?? false
  };
}

/** Compares one field: text case-insensitively, dates by calendar day. */
export function fieldEquals(expected: FlatValue, actual: FlatValue): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected !== typeof actual) return false;
  if (typeof expected === 'boolean' && typeof actual === 'boolean') return expected === actual;
  const left = String(expected);
  const right = String(actual);
  if (isIsoDate(left) && isIsoDate(right)) return toDateOnly(left) === toDateOnly(right);
  return normalizeText(left) === normalizeText(right);
}

/* ------------------------------------------------------------------ reading */

export interface ReadingScore {
  evidence: number;
  fields: number;
  correct: number;
  accuracy: number;
  pass: boolean;
  /** Evidence with no result, or with no field read at all. */
  missing: string[];
  /** `<evidenceId>: <field>` for each field read wrongly (capped by the report). */
  wrongFields: string[];
}

/** EF-LEC-01: share of Annex B fields read correctly across the 60 evidence. */
export function scoreReading(rows: readonly ReadingRow[], results: readonly ReadingResult[]): ReadingScore {
  const byId = new Map(results.map((result) => [result.evidenceId, result]));
  let correct = 0;
  let fields = 0;
  const missing: string[] = [];
  const wrongFields: string[] = [];
  for (const row of rows) {
    const result = byId.get(row.evidenceId);
    const absent = result === undefined || result.fields === null;
    if (absent) missing.push(row.evidenceId);
    const expected = expectedFlat(row);
    const actual = actualFlat(result);
    for (const key of SCORED_FIELDS) {
      fields += 1;
      // An evidence nobody read is not "right because both sides are empty".
      if (!absent && fieldEquals(expected[key] ?? null, actual[key] ?? null)) correct += 1;
      else wrongFields.push(`${row.evidenceId}: ${key}`);
    }
  }
  const accuracy = fields === 0 ? 0 : correct / fields;
  return {
    evidence: rows.length,
    fields,
    correct,
    accuracy,
    pass: accuracy > TARGETS.readingAccuracy,
    missing,
    wrongFields
  };
}

/* --------------------------------------------------------------- attachment */

export interface AttachmentScore {
  evidence: number;
  accepted: number;
  acceptanceRate: number;
  /** Wrong links a reviewer would see with a confidence above the threshold. */
  highConfidenceWrong: number;
  wrongLinks: string[];
  /** Expected controls never proposed at all. */
  missingLinks: string[];
  /** Claims whose quote was not found in the evidence (cancelled by code). */
  unsupportedClaims: number;
  pass: boolean;
}

function visibleLinks(result: AttachmentResult | undefined): Array<{ controlId: string; confidence: number }> {
  if (result === undefined) return [];
  return result.attachments
    .filter((item) => item.supports && item.citationVerified !== false)
    .map((item) => ({ controlId: item.controlId, confidence: item.confidence }));
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/** EF-RAT-01..05: share of evidence whose proposed control set needs no correction. */
export function scoreAttachment(
  rows: readonly AttachmentRow[],
  results: readonly AttachmentResult[],
  threshold: number
): AttachmentScore {
  const byId = new Map(results.map((result) => [result.evidenceId, result]));
  let accepted = 0;
  let highConfidenceWrong = 0;
  const wrongLinks: string[] = [];
  const missingLinks: string[] = [];
  let unsupportedClaims = 0;
  for (const row of rows) {
    const result = byId.get(row.evidenceId);
    const expected = new Set(row.expectedControlIds);
    const links = visibleLinks(result);
    const proposed = new Set(links.map((link) => link.controlId));
    if (sameSet(proposed, expected)) accepted += 1;
    for (const controlId of expected) {
      if (!proposed.has(controlId)) missingLinks.push(`${row.evidenceId}→${controlId}`);
    }
    for (const link of links) {
      if (expected.has(link.controlId)) continue;
      if (link.confidence < threshold) continue;
      highConfidenceWrong += 1;
      wrongLinks.push(`${row.evidenceId}→${link.controlId} (${link.confidence.toFixed(2)})`);
    }
    unsupportedClaims += (result?.attachments ?? []).filter((item) => item.supports && item.citationVerified === false).length;
  }
  const acceptanceRate = rows.length === 0 ? 0 : accepted / rows.length;
  return {
    evidence: rows.length,
    accepted,
    acceptanceRate,
    highConfidenceWrong,
    wrongLinks,
    missingLinks,
    unsupportedClaims,
    pass: acceptanceRate > TARGETS.attachmentAcceptance && highConfidenceWrong === 0
  };
}

/* -------------------------------------------------------------- sufficiency */

export interface SufficiencyScore {
  evidence: number;
  gaps: number;
  detected: number;
  missed: string[];
  spurious: string[];
  pass: boolean;
}

/** EF-SUF-01..02: every expected gap must be reported, and nothing else. */
export function scoreSufficiency(
  rows: readonly SufficiencyRow[],
  results: readonly SufficiencyResult[]
): SufficiencyScore {
  const byKey = new Map(results.map((result) => [`${result.evidenceId}|${result.controlId}`, result]));
  let gaps = 0;
  let detected = 0;
  const missed: string[] = [];
  const spurious: string[] = [];
  for (const row of rows) {
    const result = byKey.get(`${row.evidenceId}|${row.controlId}`);
    const reported = new Set(result?.missing ?? []);
    for (const element of row.expectedMissing) {
      gaps += 1;
      if (reported.has(element)) detected += 1;
      else missed.push(`${row.evidenceId}/${row.controlId}: ${element}`);
    }
    for (const element of reported) {
      if (!row.expectedMissing.includes(element)) spurious.push(`${row.evidenceId}/${row.controlId}: ${element}`);
    }
  }
  return { evidence: rows.length, gaps, detected, missed, spurious, pass: missed.length === 0 && spurious.length === 0 };
}

/* ------------------------------------------------------------------ answers */

export interface QaScore {
  evidenceQuestions: number;
  citationCorrect: number;
  citationRate: number;
  citationMisses: string[];
  traps: number;
  invented: number;
  inventedQuestions: string[];
  pass: boolean;
}

/** EF-QR-01..02: correct citations on the 20 questions, silence on the 5 traps. */
export function scoreQa(
  rows: readonly QaRow[],
  answers: readonly AnswerResult[],
  texts: EvidenceTexts | null = null
): QaScore {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  let evidenceQuestions = 0;
  let citationCorrect = 0;
  let traps = 0;
  let invented = 0;
  const citationMisses: string[] = [];
  const inventedQuestions: string[] = [];
  for (const row of rows) {
    const answer = byId.get(row.questionId);
    if (row.expectedAnswerKind === 'NO_EVIDENCE') {
      traps += 1;
      // Citing a document is an invented answer, whatever the answer claims to be.
      const answered = answer !== undefined && (answer.answerKind === 'EVIDENCE' || answer.citations.length > 0);
      if (answered) {
        invented += 1;
        inventedQuestions.push(row.questionId);
      }
      continue;
    }
    evidenceQuestions += 1;
    const citations = answer?.citations ?? [];
    const cited = new Set(citations.map((citation) => citation.evidenceId));
    const expected = row.expectedEvidenceIds.filter((id) => cited.has(id));
    // The cited passage must also be found in the document when the text is known.
    const grounded = expected.filter((id) => {
      const citation = citations.find((entry) => entry.evidenceId === id);
      return quoteSupported(texts, id, citation?.quote);
    });
    const correct = answer?.answerKind === 'EVIDENCE' && grounded.length > 0;
    if (correct) citationCorrect += 1;
    else citationMisses.push(row.questionId);
  }
  const citationRate = evidenceQuestions === 0 ? 0 : citationCorrect / evidenceQuestions;
  return {
    evidenceQuestions,
    citationCorrect,
    citationRate,
    citationMisses,
    traps,
    invented,
    inventedQuestions,
    pass: citationRate > TARGETS.citationAccuracy && invented === 0
  };
}

/* --------------------------------------------------------------- whole run */

export interface RunScore {
  runId: string;
  producedBy: string;
  reading: ReadingScore;
  attachment: AttachmentScore;
  sufficiency: SufficiencyScore;
  qa: QaScore;
  pass: boolean;
}

/** Scores a whole run against the four datasets. */
export function scoreRun(
  datasets: { reading: readonly ReadingRow[]; attachment: readonly AttachmentRow[]; sufficiency: readonly SufficiencyRow[]; qa: readonly QaRow[] },
  results: RunResults,
  threshold: number,
  texts: EvidenceTexts | null = null
): RunScore {
  const reading = scoreReading(datasets.reading, results.reading);
  const attachment = scoreAttachment(datasets.attachment, results.attachment, threshold);
  const sufficiency = scoreSufficiency(datasets.sufficiency, results.sufficiency);
  const qa = scoreQa(datasets.qa, results.answers, texts);
  return {
    runId: results.runId,
    producedBy: results.producedBy,
    reading,
    attachment,
    sufficiency,
    qa,
    pass: reading.pass && attachment.pass && sufficiency.pass && qa.pass
  };
}
