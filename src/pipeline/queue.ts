/**
 * Validation queue — EF-VAL-01 ("file de validation : rattachements incertains,
 * suffisances partielles, preuves illisibles") and EF-VAL-02 (every decision
 * keeps its author, its date and its reason).
 *
 * Items are built here, once, so the attachment step, the sufficiency step and
 * the queue refresh all produce the same shape and the same deterministic id
 * (`validationId`), which makes the queue idempotent: refreshing it twice never
 * duplicates an item.
 */

import type { Attachment, Evidence, Sufficiency, ValidationItem } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { validationId } from '../support/ids.ts';

/** One validation item, deterministic id included — EF-VAL-01. */
function itemOf(
  kind: ValidationItem['kind'],
  refId: string,
  reason: string,
  now: string,
  refs: Partial<Pick<ValidationItem, 'attachmentId' | 'evidenceId' | 'controlId'>>
): ValidationItem {
  return {
    id: validationId(kind, refId),
    kind,
    ...refs,
    reason,
    createdAt: now,
    status: 'PENDING'
  };
}

/** Pending review of one proposed attachment — EF-RAT-03, EF-VAL-01. */
export function attachmentItem(attachment: Attachment, threshold: number, now: string): ValidationItem {
  const reason = `confidence ${attachment.confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}`;
  return itemOf('ATTACHMENT', attachment.id, reason, now, {
    attachmentId: attachment.id,
    evidenceId: attachment.evidenceId,
    controlId: attachment.controlId
  });
}

/** Pending review of a partial sufficiency — EF-SUF-02, EF-VAL-01. */
export function sufficiencyItem(sufficiency: Sufficiency, now: string): ValidationItem {
  const missing = sufficiency.missing.length > 0 ? sufficiency.missing.join(', ') : 'none listed';
  return itemOf('SUFFICIENCY', sufficiency.attachmentId, `expected elements missing: ${missing}`, now, {
    attachmentId: sufficiency.attachmentId,
    evidenceId: sufficiency.evidenceId,
    controlId: sufficiency.controlId
  });
}

/** Pending review of an evidence the reader could not use — EF-LEC-04, EF-VAL-01. */
export function evidenceReviewItem(evidence: Evidence, now: string): ValidationItem {
  return itemOf('UNREADABLE_EVIDENCE', evidence.id, reviewReason(evidence), now, { evidenceId: evidence.id });
}

/** Why a document needs a human look, from the reading flags — EF-LEC-04. */
function reviewReason(evidence: Evidence): string {
  if (evidence.flags.unreadable) return 'the document could not be read';
  if (evidence.flags.missingDate) return 'the document carries no readable date';
  if (evidence.flags.dateToConfirm) return 'the document date differs from the file date and must be confirmed';
  return 'the document has no readable author';
}

/** True when the reading flags force a human review — EF-LEC-04. */
export function needsReview(evidence: Evidence): boolean {
  return (
    evidence.flags.unreadable ||
    evidence.flags.missingDate ||
    evidence.flags.dateToConfirm ||
    evidence.flags.missingAuthor
  );
}

/**
 * Identity of the situation an item describes: one pending item per subject, so
 * a refresh never duplicates a review already waiting — EF-VAL-01.
 */
function subjectKey(item: ValidationItem): string {
  const subject = item.attachmentId ?? item.evidenceId ?? item.controlId ?? item.id;
  return `${item.kind}|${subject}`;
}

/**
 * Ensures every situation that needs a human has its pending item, without
 * duplicating one that already exists — EF-VAL-01.
 */
export async function refreshValidationQueue(services: Services): Promise<ValidationItem[]> {
  const now = services.clock.now();
  const existing = new Set(
    (await services.state.listValidations({ status: 'PENDING' })).map((item) => subjectKey(item))
  );
  const threshold = services.settings.confidenceThreshold;
  const created: ValidationItem[] = [];

  for (const attachment of await services.state.listAttachments({ status: 'PROPOSED' })) {
    created.push(attachmentItem(attachment, threshold, now));
  }
  for (const sufficiency of await services.state.listSufficiency()) {
    if (sufficiency.class === 'PARTIAL') created.push(sufficiencyItem(sufficiency, now));
  }
  for (const evidence of await services.state.listEvidence()) {
    if (needsReview(evidence)) created.push(evidenceReviewItem(evidence, now));
  }

  const fresh = created.filter((item) => !existing.has(subjectKey(item)));
  for (const item of fresh) await services.state.putValidation(item);
  return [...(await services.state.listValidations({ status: 'PENDING' }))];
}
