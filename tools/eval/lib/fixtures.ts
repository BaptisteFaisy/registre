/**
 * Reference run results derived from the datasets: a perfect run, and the same
 * run with one named degradation applied. One implementation, used by the
 * scorer tests and by `makeFixtureResults.ts`.
 */

import type { BuiltDatasets } from './rows.ts';
import type { AnswerResult, AttachmentResult, ReadingResult, RunResults, SufficiencyResult } from './results.ts';

function readingResult(row: BuiltDatasets['reading'][number]): ReadingResult {
  return {
    evidenceId: row.evidenceId,
    fields: structuredClone(row.expectedFields),
    flags: { ...row.expectedFlags },
    accessLevel: row.expectedAccessLevel
  };
}

function attachmentResult(row: BuiltDatasets['attachment'][number]): AttachmentResult {
  return {
    evidenceId: row.evidenceId,
    attachments: row.expectedControlIds.map((controlId) => ({
      controlId,
      supports: true,
      confidence: 0.93,
      quote: 'quote verified against the evidence text',
      citationVerified: true
    }))
  };
}

function sufficiencyResult(row: BuiltDatasets['sufficiency'][number]): SufficiencyResult {
  return { evidenceId: row.evidenceId, controlId: row.controlId, missing: [...row.expectedMissing] };
}

function answerResult(row: BuiltDatasets['qa'][number]): AnswerResult {
  if (row.expectedAnswerKind === 'NO_EVIDENCE') {
    return { questionId: row.questionId, answerKind: 'NO_EVIDENCE', citations: [] };
  }
  return {
    questionId: row.questionId,
    answerKind: 'EVIDENCE',
    citations: row.expectedEvidenceIds.map((evidenceId) => ({ evidenceId, quote: 'cited passage', page: 1 }))
  };
}

/** A run that reproduces every dataset expectation exactly. */
export function perfectResults(datasets: BuiltDatasets, runId = 'fixture-perfect'): RunResults {
  return {
    runId,
    producedBy: 'fixture',
    reading: datasets.reading.map(readingResult),
    attachment: datasets.attachment.map(attachmentResult),
    sufficiency: datasets.sufficiency.map(sufficiencyResult),
    answers: datasets.qa.map(answerResult)
  };
}

/** One named mistake; every field is optional so a test can isolate one measure. */
export interface Degradation {
  /** The reader returns no fields for this evidence. */
  dropReading?: string;
  /** One field is read wrongly for this evidence. */
  wrongField?: { evidenceId: string; field: string; value: string };
  /** A link is proposed although no control is expected (wrong, high confidence). */
  wrongHighConfidence?: { evidenceId: string; controlId: string };
  /** An expected link is not proposed at all. */
  dropAttachment?: { evidenceId: string; controlId: string };
  /** A sufficiency check reports no gap although one is expected. */
  forgetGap?: { evidenceId: string; controlId: string };
  /** A sufficiency check reports an element that is actually present. */
  spuriousGap?: { evidenceId: string; controlId: string; element: string };
  /** An invented answer to a trap question. */
  inventAnswer?: string;
  /** An answer whose citation is not the expected evidence. */
  wrongCitation?: string;
}

function applyReading(results: ReadingResult[], plan: Degradation): void {
  for (const result of results) {
    if (plan.dropReading === result.evidenceId) result.fields = null;
    if (plan.wrongField !== undefined && plan.wrongField.evidenceId === result.evidenceId && result.fields !== null) {
      const mutable = result.fields as Record<string, unknown>;
      mutable[plan.wrongField.field] = plan.wrongField.value;
    }
  }
}

function applyAttachment(results: AttachmentResult[], plan: Degradation): void {
  for (const result of results) {
    if (plan.wrongHighConfidence !== undefined && plan.wrongHighConfidence.evidenceId === result.evidenceId) {
      result.attachments.push({
        controlId: plan.wrongHighConfidence.controlId,
        supports: true,
        confidence: 0.94,
        quote: 'passage that does not support the control',
        citationVerified: true
      });
    }
    if (plan.dropAttachment !== undefined && plan.dropAttachment.evidenceId === result.evidenceId) {
      result.attachments = result.attachments.filter((entry) => entry.controlId !== plan.dropAttachment?.controlId);
    }
  }
}

function applySufficiency(results: SufficiencyResult[], plan: Degradation): void {
  for (const result of results) {
    if (plan.forgetGap !== undefined && plan.forgetGap.evidenceId === result.evidenceId) result.missing = [];
    if (plan.spuriousGap !== undefined && plan.spuriousGap.evidenceId === result.evidenceId) {
      result.missing = [...result.missing, plan.spuriousGap.element];
    }
  }
}

function applyAnswers(results: AnswerResult[], plan: Degradation): void {
  for (const result of results) {
    if (result.questionId === plan.inventAnswer) {
      result.answerKind = 'EVIDENCE';
      result.citations = [{ evidenceId: 'EV-001', quote: 'invented passage', page: 1 }];
    }
    if (result.questionId === plan.wrongCitation) {
      result.answerKind = 'EVIDENCE';
      result.citations = [{ evidenceId: 'EV-060', quote: 'unrelated passage', page: 1 }];
    }
  }
}

/** Applies one degradation plan to a perfect run. */
export function degradedResults(datasets: BuiltDatasets, plan: Degradation, runId = 'fixture-degraded'): RunResults {
  const results = perfectResults(datasets, runId);
  applyReading(results.reading, plan);
  applyAttachment(results.attachment, plan);
  applySufficiency(results.sufficiency, plan);
  applyAnswers(results.answers, plan);
  return results;
}
