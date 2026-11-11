/**
 * Validation queue and human decisions — EF-VAL-01 ("file de validation :
 * rattachements incertains, suffisances partielles, preuves illisibles") and
 * EF-VAL-02 ("chaque validation garde son auteur, sa date et son motif").
 *
 * The role check belongs to the API (`canDecide` of `src/domain/access.ts`);
 * here the caller states who decided, and that name is what the log keeps.
 */

import type { Attachment, ControlStatus, FrameworkId, ValidationItem } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { badRequest, conflict, notFound } from '../support/errors.ts';
import { record } from '../audit/log.ts';
import { refreshValidationQueue } from './queue.ts';
import { recomputeFrameworks } from './states.ts';
import type { DecisionInput } from './types.ts';

/** Pending items, built from the store so nothing is lost between two runs — EF-VAL-01. */
export async function listValidationQueue(services: Services): Promise<ValidationItem[]> {
  return refreshValidationQueue(services);
}

/**
 * Records a human decision on one item, applies it, journals it and recomputes
 * the states it affects — EF-VAL-01/02 (acceptance: accept, reject, correct).
 */
export async function decideValidation(
  services: Services,
  itemId: string,
  decision: DecisionInput
): Promise<{ item: ValidationItem; statuses: ControlStatus[] }> {
  const pending = await requirePending(services, itemId);
  assertNotePresent(decision);
  const item = decidedItem(pending, decision, services.clock.now());
  await services.state.putValidation(item);
  await applyDecision(services, item, decision);
  await record(services, decision.by, 'VALIDATION_DECIDED', 'validation', item.id, {
    kind: item.kind,
    decision: decision.decision,
    ...(item.controlId === undefined ? {} : { controlId: item.controlId }),
    ...(item.attachmentId === undefined ? {} : { attachmentId: item.attachmentId }),
    ...(decision.note === undefined ? {} : { note: decision.note })
  });
  const statuses = await recomputeFrameworks(services, await frameworksOf(services, item));
  return { item, statuses };
}

/** Reads the item and refuses an already decided one — EF-VAL-01. */
async function requirePending(services: Services, itemId: string): Promise<ValidationItem> {
  const item = await services.state.getValidation(itemId);
  if (!item) throw notFound(`validation item ${itemId} does not exist`);
  if (item.status !== 'PENDING') {
    throw conflict(`validation item ${itemId} was already decided`, { decision: item.decision });
  }
  return item;
}

/** A correction must say what was corrected — EF-VAL-02. */
function assertNotePresent(decision: DecisionInput): void {
  if (decision.decision !== 'CORRECT') return;
  if ((decision.note ?? '').trim().length > 0) return;
  throw badRequest('a CORRECT decision must carry a note explaining the correction');
}

/** The item with its author, its date and its reason kept for good — EF-VAL-02. */
function decidedItem(item: ValidationItem, decision: DecisionInput, now: string): ValidationItem {
  return {
    ...item,
    status: 'DECIDED',
    decision: decision.decision,
    decidedBy: decision.by,
    decidedAt: now,
    ...(decision.note === undefined ? {} : { note: decision.note })
  };
}

/**
 * Applies the decision: accept and correct apply the attachment, reject refuses
 * it with `HUMAN_REJECTED` — chapter 12.1 (acceptance: decide a validation).
 */
async function applyDecision(services: Services, item: ValidationItem, decision: DecisionInput): Promise<void> {
  if (item.kind !== 'ATTACHMENT' || item.attachmentId === undefined) return;
  const attachment = await services.state.getAttachment(item.attachmentId);
  if (!attachment) throw notFound(`attachment ${item.attachmentId} does not exist`);
  const applied = decision.decision !== 'REJECT';
  await services.state.putAttachment(decidedAttachment(attachment, item, applied));
  if (applied) await validateType(services, item, decision.by);
}

/** The attachment after a human decision; a rejection always carries its reason — EF-VAL-02. */
function decidedAttachment(attachment: Attachment, item: ValidationItem, applied: boolean): Attachment {
  const decision = { decidedBy: item.decidedBy, decidedAt: item.decidedAt };
  const note = item.note === undefined ? {} : { decidedNote: item.note };
  if (!applied) {
    return { ...attachment, ...decision, ...note, status: 'REJECTED', rejectionReason: 'HUMAN_REJECTED' };
  }
  return { ...attachment, ...decision, ...note, status: 'APPLIED', autoApplied: false };
}

/** A human accepting an attachment validates that evidence type for the control — EF-SUF-03. */
async function validateType(services: Services, item: ValidationItem, by: string): Promise<void> {
  if (item.controlId === undefined || item.evidenceId === undefined) return;
  const evidence = await services.state.getEvidence(item.evidenceId);
  await services.state.markTypeValidated(item.controlId, evidence?.fields.type ?? 'UNKNOWN', by);
}

/** Frameworks whose states must be recomputed after the decision — EF-FRA-02. */
async function frameworksOf(services: Services, item: ValidationItem): Promise<FrameworkId[]> {
  if (item.attachmentId !== undefined) {
    const attachment = await services.state.getAttachment(item.attachmentId);
    if (attachment) return [attachment.frameworkId];
  }
  if (item.controlId === undefined) return [];
  const control = await services.state.getControl(item.controlId);
  return control ? [control.frameworkId] : [];
}
