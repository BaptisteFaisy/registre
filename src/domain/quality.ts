/**
 * Drift detection and measured-quality entities.
 *
 * Two ideas live here, both about the system watching itself instead of waiting
 * for the audit:
 *
 *  - DRIFT (machine attestations). A collector produces a dated statement about
 *    a real state — last night's backups, this month's access review. When that
 *    state changes, or when an expected run does not arrive, the control must
 *    move within the day, not at the next audit. `DriftEvent` records the
 *    transition; the reminder carries it to the owner.
 *
 *  - MEASURED QUALITY (the system grades itself). Every attachment and every
 *    answer is produced by a model at a given prompt version. Bedrock evaluation
 *    jobs score those versions against the datasets; `QualityRecord` stores the
 *    verdict, and `effectiveConfidenceThreshold` uses it: when a measured metric
 *    drops below its target, the pipeline stops auto-applying and routes the
 *    class to a human. The tool never claims an accuracy it cannot prove.
 */

import type { ControlId, EvidenceId, FrameworkId, ReminderId } from './types.ts';

/* ------------------------------------------------------------------ drift */

export type DriftKind = 'STATE_CHANGED' | 'MISSING_RUN' | 'THRESHOLD_CROSSED' | 'RECOVERED';

/** One observed change in a machine attestation. */
export interface DriftEvent {
  id: string;
  controlId: ControlId;
  frameworkId: FrameworkId;
  /** The attestation that carries the observation. */
  evidenceId: EvidenceId | null;
  detectedAt: string;
  kind: DriftKind;
  /** Previous observed value, `null` on a first observation. */
  previous: string | null;
  current: string | null;
  /** Human-readable one-liner, safe to put in a reminder. */
  detail: string;
  reminderId: ReminderId | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/** How often a machine attestation is expected to be refreshed. */
export interface RefreshPolicy {
  /** Hours between two expected runs of the collector. */
  cadenceHours: number;
  /** Grace period, in hours, before a missing run is a drift. */
  graceHours: number;
}

/** Default policy: daily run, six hours of grace. */
export const DEFAULT_REFRESH_POLICY: RefreshPolicy = { cadenceHours: 24, graceHours: 6 };

/**
 * ISO-8601 duration of a refresh cadence, so a machine attestation goes through
 * the very same freshness arithmetic as a human document (ENF-IA-04: dates are
 * computed by code, one implementation).
 */
export function cadencePeriodicity(policy: RefreshPolicy = DEFAULT_REFRESH_POLICY): string {
  return `PT${policy.cadenceHours}H`;
}

/** Deterministic drift id: one drift per control, kind and detection day. */
export function driftId(controlId: ControlId, kind: DriftKind, day: string): string {
  return `dr-${controlId}-${kind.toLowerCase()}-${day}`;
}

/* --------------------------------------------------------- measured quality */

export type QualitySubjectKind = 'READING' | 'ATTACHMENT' | 'SUFFICIENCY' | 'QA';

/** The thing being graded: a task, a model, and a prompt version. */
export interface QualitySubject {
  kind: QualitySubjectKind;
  modelId: string;
  promptVersion: string;
}

export type QualityMetric =
  | 'FIELD_ACCURACY'
  | 'ACCEPTED_WITHOUT_CORRECTION'
  | 'WRONG_HIGH_CONFIDENCE'
  | 'GAPS_DETECTED'
  | 'CITATION_ACCURACY'
  | 'INVENTED_ANSWERS';

export type QualityVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** One measurement of one metric for one subject. */
export interface QualityRecord {
  id: string;
  measuredAt: string;
  subject: QualitySubject;
  metric: QualityMetric;
  /** 0..1 for ratios, absolute count for the two "must be zero" metrics. */
  value: number;
  target: number;
  sampleCount: number;
  datasetVersion: string;
  /** Bedrock evaluation job id, `null` for a local scoring run. */
  jobId: string | null;
  verdict: QualityVerdict;
}

/** One point of the trend shown on the quality screen. */
export interface QualityTrendPoint {
  measuredAt: string;
  subjectKey: string;
  metric: QualityMetric;
  value: number;
  verdict: QualityVerdict;
}

/** Stable key of a subject, used to group the trend. */
export function subjectKey(subject: QualitySubject): string {
  return `${subject.kind}:${subject.modelId}:${subject.promptVersion}`;
}

/**
 * Confidence threshold actually applied for attachments.
 *
 * Without a measurement, the configured threshold applies. Once a measurement
 * exists and is below target, auto-application stops entirely (threshold 1.01,
 * unreachable): everything goes to the validation queue until a human looks at
 * it. This is the concrete form of "the doubt goes to verify, never to covered".
 */
export function effectiveConfidenceThreshold(
  configured: number,
  records: readonly QualityRecord[]
): number {
  const latest = latestAttachmentAccuracy(records);
  if (latest === null) return configured;
  return latest.verdict === 'PASS' ? configured : 1.01;
}

/** Most recent ACCEPTED_WITHOUT_CORRECTION measurement, if any. */
export function latestAttachmentAccuracy(
  records: readonly QualityRecord[]
): QualityRecord | null {
  const relevant = records
    .filter((record) => record.metric === 'ACCEPTED_WITHOUT_CORRECTION')
    .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
  return relevant[0] ?? null;
}
