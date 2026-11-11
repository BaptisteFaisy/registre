/**
 * Views of the extension entities (axes 1 to 3 and measured quality).
 *
 * Kept apart from `views.ts` so the chapter-15 views stay untouched. One rule
 * dominates this file: `verificationView` publishes **nothing but** ids, hashes,
 * counts and verdicts — a public verifier must never become a leak (ENF-CONF-03).
 */

import type { Draft } from '../domain/draft.ts';
import type { ControlMapping, ReuseMetric } from '../domain/mapping.ts';
import type { DriftEvent, QualityRecord } from '../domain/quality.ts';
import { subjectKey } from '../domain/quality.ts';
import type { ShareGrant, VerificationResult } from '../domain/verification.ts';
import type { QualityMetricLine, QualitySubjectReport } from '../pipeline/quality.ts';

/** Verification verdict: safe to publish, no evidence content (ENF-CONF-03). */
export function verificationView(result: VerificationResult): Record<string, unknown> {
  return {
    packId: result.packId,
    frameworkId: result.frameworkId,
    verifiedAt: result.verifiedAt,
    frozenAt: result.frozenAt,
    rootHash: result.rootHash,
    controlCount: result.controlCount,
    evidenceCount: result.evidenceCount,
    knownGapCount: result.knownGapCount,
    checksumsOk: result.checksumsOk,
    chainOk: result.chainOk,
    signatureOk: result.signatureOk,
    signerKeyId: result.signerKeyId,
    algorithm: result.algorithm
  };
}

/**
 * Share grant as the portal sees it. The token is returned once, when the grant
 * is created or listed to its owner; it is never written to the audit log.
 */
export function shareView(share: ShareGrant, options: { hideToken?: boolean } = {}): Record<string, unknown> {
  return {
    token: options.hideToken === true ? `${share.token.slice(0, 6)}…` : share.token,
    packId: share.packId,
    frameworkId: share.frameworkId,
    scope: share.scope,
    createdBy: share.createdBy,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    revokedBy: share.revokedBy,
    watermark: share.watermark,
    useCount: share.useCount,
    lastUsedAt: share.lastUsedAt
  };
}

/** Cross-framework mapping, with both verified quotes — EF-REF-04. */
export function mappingView(mapping: ControlMapping): Record<string, unknown> {
  return {
    id: mapping.id,
    sourceFrameworkId: mapping.sourceFrameworkId,
    sourceControlId: mapping.sourceControlId,
    targetFrameworkId: mapping.targetFrameworkId,
    targetControlId: mapping.targetControlId,
    direction: mapping.direction,
    confidence: mapping.confidence,
    sourceQuote: mapping.sourceQuote,
    targetQuote: mapping.targetQuote,
    reason: mapping.reason,
    status: mapping.status,
    citationVerified: mapping.citationVerified,
    proposedBy: mapping.proposedBy,
    proposedAt: mapping.proposedAt,
    ...(mapping.validatedBy === undefined ? {} : { validatedBy: mapping.validatedBy }),
    ...(mapping.validatedAt === undefined ? {} : { validatedAt: mapping.validatedAt }),
    ...(mapping.note === undefined ? {} : { note: mapping.note })
  };
}

/** Reuse metric — what one deposited evidence is worth across frameworks. */
export function reuseView(metric: ReuseMetric): Record<string, unknown> {
  return {
    frameworkId: metric.frameworkId,
    computedAt: metric.computedAt,
    evidenceCount: metric.evidenceCount,
    attachmentCount: metric.attachmentCount,
    carriedAttachments: metric.carriedAttachments,
    avoidedDeposits: metric.avoidedDeposits,
    reuseFactor: metric.reuseFactor,
    validatedMappings: metric.validatedMappings,
    pendingMappings: metric.pendingMappings
  };
}

/** One drift event. */
export function driftView(event: DriftEvent): Record<string, unknown> {
  return {
    id: event.id,
    controlId: event.controlId,
    frameworkId: event.frameworkId,
    evidenceId: event.evidenceId,
    detectedAt: event.detectedAt,
    kind: event.kind,
    previous: event.previous,
    current: event.current,
    detail: event.detail,
    reminderId: event.reminderId,
    acknowledgedAt: event.acknowledgedAt,
    acknowledgedBy: event.acknowledgedBy
  };
}

/** A draft: watermarked, never an evidence (`attachable: false`). */
export function draftView(draft: Draft): Record<string, unknown> {
  return {
    id: draft.id,
    controlId: draft.controlId,
    frameworkId: draft.frameworkId,
    createdAt: draft.createdAt,
    format: draft.format,
    title: draft.title,
    watermark: draft.watermark,
    status: draft.status,
    sections: draft.sections,
    basedOn: draft.basedOn,
    missing: draft.missing,
    content: draft.content,
    attachable: draft.attachable
  };
}

/** One row of the quality screen: one metric of one subject, with its history. */
export interface QualityRow {
  subject: QualityRecord['subject'];
  metric: QualityRecord['metric'];
  value: number;
  target: number;
  verdict: QualityRecord['verdict'];
  trend: number[];
  measuredAt: string;
}

/** Flattens one subject block into rows, oldest-first history per metric. */
export function qualityRows(
  subject: QualitySubjectReport,
  history: readonly QualityRecord[]
): QualityRow[] {
  const out: QualityRow[] = [];
  for (const line of subject.metrics) {
    out.push(rowOf(subject, line, history));
  }
  return out;
}

function rowOf(
  subject: QualitySubjectReport,
  line: QualityMetricLine,
  history: readonly QualityRecord[]
): QualityRow {
  const past = history
    .filter((record) => subjectKey(record.subject) === subject.subjectKey && record.metric === line.metric)
    .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt))
    .map((record) => record.value);
  return {
    subject: subject.subject,
    metric: line.metric,
    value: line.latestValue,
    target: line.target,
    verdict: line.verdict,
    trend: past,
    measuredAt: line.measuredAt
  };
}
