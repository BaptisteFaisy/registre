/**
 * Conversion from the scorer's six metrics to measured-quality inputs.
 *
 * One implementation, shared by `runAndRecord.ts` and by the tests, so the
 * runner never re-derives what the scorer already computed (zero duplication).
 * The mapping is fixed by spec 13.5:
 *
 *   FIELD_ACCURACY               reading accuracy            ratio, target 0.9
 *   ACCEPTED_WITHOUT_CORRECTION  attachment acceptance       ratio, target 0.85
 *   WRONG_HIGH_CONFIDENCE        wrong links above threshold  must be zero
 *   GAPS_DETECTED                detected / expected gaps    ratio, target 1
 *   CITATION_ACCURACY            correct citations           ratio, target 0.9
 *   INVENTED_ANSWERS             answers on the traps         must be zero
 *
 * Pure functions, no I/O, no network.
 */

import { sha256Json } from '../../../src/support/hash.ts';
import { PROMPT_VERSIONS } from '../../../src/ai/versioning.ts';
import type { QualitySubject, QualitySubjectKind } from '../../../src/domain/quality.ts';
import type { EvaluationInput, QualityMeasurement } from '../../../src/pipeline/quality.ts';
import { TARGETS } from './scoring.ts';
import type { RunScore } from './scoring.ts';
import type { LoadedDatasets } from './datasets.ts';

/** Deterministic version tag of the loaded datasets (`ds-<12 hex>`). */
export function datasetVersionOf(datasets: LoadedDatasets): string {
  return `ds-${sha256Json(datasets).slice(0, 12)}`;
}

/** Prompt family version stamped on each subject kind. */
export function promptVersionFor(kind: QualitySubjectKind): string {
  return kind === 'QA' ? PROMPT_VERSIONS.ANSWER : PROMPT_VERSIONS[kind];
}

/** Subject of a local scoring run: the run identity stands for the model. */
export function subjectFor(kind: QualitySubjectKind, score: RunScore): QualitySubject {
  return { kind, modelId: score.producedBy, promptVersion: promptVersionFor(kind) };
}

function ratio(metric: QualityMeasurement['metric'], value: number, target: number, sampleCount: number, datasetVersion: string): QualityMeasurement {
  return { metric, value, target, sampleCount, datasetVersion };
}

function readingInput(score: RunScore, datasetVersion: string): EvaluationInput {
  return {
    subject: subjectFor('READING', score),
    records: [ratio('FIELD_ACCURACY', score.reading.accuracy, TARGETS.readingAccuracy, score.reading.fields, datasetVersion)]
  };
}

function attachmentInput(score: RunScore, datasetVersion: string): EvaluationInput {
  return {
    subject: subjectFor('ATTACHMENT', score),
    records: [
      ratio('ACCEPTED_WITHOUT_CORRECTION', score.attachment.acceptanceRate, TARGETS.attachmentAcceptance, score.attachment.evidence, datasetVersion),
      ratio('WRONG_HIGH_CONFIDENCE', score.attachment.highConfidenceWrong, 0, score.attachment.evidence, datasetVersion)
    ]
  };
}

function sufficiencyInput(score: RunScore, datasetVersion: string): EvaluationInput {
  const { detected, gaps, evidence } = score.sufficiency;
  const value = gaps === 0 ? 1 : detected / gaps;
  return {
    subject: subjectFor('SUFFICIENCY', score),
    records: [ratio('GAPS_DETECTED', value, 1, gaps === 0 ? evidence : gaps, datasetVersion)]
  };
}

function qaInput(score: RunScore, datasetVersion: string): EvaluationInput {
  return {
    subject: subjectFor('QA', score),
    records: [
      ratio('CITATION_ACCURACY', score.qa.citationRate, TARGETS.citationAccuracy, score.qa.evidenceQuestions, datasetVersion),
      ratio('INVENTED_ANSWERS', score.qa.invented, 0, score.qa.traps, datasetVersion)
    ]
  };
}

/** The six metrics of one scored run, grouped into four evaluation inputs. */
export function evaluationInputsForScore(score: RunScore, datasetVersion: string): EvaluationInput[] {
  return [
    readingInput(score, datasetVersion),
    attachmentInput(score, datasetVersion),
    sufficiencyInput(score, datasetVersion),
    qaInput(score, datasetVersion)
  ];
}
