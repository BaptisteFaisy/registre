/**
 * Mock upload pipeline (EF-COL-02, EF-LEC-01..04, EF-RAT-01..03, EF-SUF-01).
 *
 * The portal cannot run Bedrock without a backend, so the demo upload always
 * returns the same realistic outcome: the deposited restore-test minute is read,
 * attached to two controls with a cited passage, and judged partial because the
 * measured recovery time is missing — the exact sequence of the 3-minute video.
 */

import type { Evidence, Principal } from '../api/types.ts';
import { appendAuditEvent } from './activity.ts';
import { buildAttachment, buildSufficiency, pickQuote } from './engine.ts';
import { evidenceFromSpec } from './evidence.ts';
import type { EvidenceSpec } from './evidenceSpecs.ts';
import { recomputeStatuses } from './dataset.ts';
import type { MockStore } from './store.ts';

const PRIMARY_CONTROL = 'BCP-02';
const SECONDARY_CONTROL = 'BCP-03';

/** Spec of the document the demo pretends to deposit. */
function uploadedSpec(fileName: string, today: string): EvidenceSpec {
  return {
    id: '',
    controlIds: [PRIMARY_CONTROL, SECONDARY_CONTROL],
    type: 'REPORT',
    title: 'Backup restore test report (uploaded)',
    date: today,
    author: 'Kwame Mensah',
    approver: 'Claire Fontaine',
    access: 'INTERNAL',
    pages: [
      `Backup restore test report. Restored system: portal-prod-01. Result: successful. The test was run by the continuity team on ${today} and the database was restored from the vault catalogue.`,
      'Participants: continuity owner, database administrator, service desk manager. The report is signed by the continuity owner and countersigned by the managing director.'
    ],
    missing: ['measured recovery time'],
    note: `Deposited as ${fileName} and attached to the quarterly restore test controls.`
  };
}

/** Applies the simulated read + attachment + sufficiency pipeline. */
export function simulateUpload(
  state: MockStore,
  principal: Principal,
  input: { fileName: string; sizeBytes: number; accessLevel?: string }
): Evidence {
  const today = new Date().toISOString().slice(0, 10);
  const spec = uploadedSpec(input.fileName, today);
  const evidence = evidenceFromSpec({ ...spec, id: `ev-up-${state.db.evidence.length + 1}` });
  evidence.sizeBytes = input.sizeBytes || evidence.sizeBytes;
  if (input.accessLevel === 'RESTRICTED') evidence.accessLevel = 'RESTRICTED';
  state.db.evidence.push(evidence);

  auditCollection(state, principal, evidence, input.fileName);
  const quote = pickQuote(evidence);
  attach(state, evidence, spec, PRIMARY_CONTROL, 0.91, 'APPLIED', quote, principal);
  attach(state, evidence, spec, SECONDARY_CONTROL, 0.79, 'PROPOSED', quote, principal);
  recomputeStatuses(state.db);
  return evidence;
}

/** Collection and reading events of a freshly deposited document. */
function auditCollection(
  state: MockStore,
  principal: Principal,
  evidence: Evidence,
  fileName: string
): void {
  const at = new Date().toISOString();
  appendAuditEvent(state.audit, {
    at,
    actor: principal.name,
    action: 'EVIDENCE_COLLECTED',
    objectType: 'evidence',
    objectId: evidence.id,
    detail: { source: 'manual', fileName }
  });
  appendAuditEvent(state.audit, {
    at,
    actor: 'pipeline',
    action: 'EVIDENCE_READ',
    objectType: 'evidence',
    objectId: evidence.id,
    detail: { reader: 'bedrock-data-automation', pages: evidence.textPages.length }
  });
}

/** Creates one attachment, its sufficiency, and the matching side effects. */
function attach(
  state: MockStore,
  evidence: Evidence,
  spec: EvidenceSpec,
  controlId: string,
  confidence: number,
  status: 'APPLIED' | 'PROPOSED',
  quote: { quote: string; page: number },
  principal: Principal
): void {
  const control = state.db.controls.find((item) => item.id === controlId);
  if (!control) return;
  const attachment = buildAttachment(
    { ...spec, confidence, status },
    evidence,
    controlId,
    control.frameworkId,
    state.db.attachments.length + 1,
    state.db.settings.confidenceThreshold
  );
  attachment.quote = quote.quote;
  attachment.quoteLocation = { page: quote.page };
  state.db.attachments.push(attachment);

  const sufficiency = buildSufficiency(
    attachment,
    control,
    evidence,
    spec,
    state.db.sufficiencies.length + 1,
    state.db.now
  );
  state.db.sufficiencies.push(sufficiency);

  const at = new Date().toISOString();
  appendAuditEvent(state.audit, {
    at,
    actor: 'pipeline',
    action: status === 'APPLIED' ? 'ATTACHMENT_APPLIED' : 'ATTACHMENT_PROPOSED',
    objectType: 'attachment',
    objectId: attachment.id,
    detail: { controlId, confidence, sufficiency: sufficiency.class }
  });

  if (status === 'PROPOSED') queueAttachmentReview(state, attachment.id, evidence.id, controlId, confidence, at);
  if (sufficiency.class === 'PARTIAL') {
    queueSufficiencyReview(state, attachment.id, evidence.id, controlId, sufficiency.missing, at);
    remindOwner(state, principal, control, sufficiency.missing, at);
  }
}

/** Puts an attachment below the threshold in the validation queue. */
function queueAttachmentReview(
  state: MockStore,
  attachmentId: string,
  evidenceId: string,
  controlId: string,
  confidence: number,
  at: string
): void {
  state.validations.push({
    id: nextValidationId(state),
    kind: 'ATTACHMENT',
    attachmentId,
    evidenceId,
    controlId,
    reason: `Confidence ${Math.round(confidence * 100)} % is below the review threshold: confirm the target control.`,
    createdAt: at,
    status: 'PENDING'
  });
}

/** Puts a partial sufficiency in the validation queue. */
function queueSufficiencyReview(
  state: MockStore,
  attachmentId: string,
  evidenceId: string,
  controlId: string,
  missing: readonly string[],
  at: string
): void {
  state.validations.push({
    id: nextValidationId(state),
    kind: 'SUFFICIENCY',
    attachmentId,
    evidenceId,
    controlId,
    reason: `The document does not state the following element: ${missing.join(', ')}.`,
    createdAt: at,
    status: 'PENDING'
  });
}

/** Sends the owner the list of what is missing (EF-REL-01). */
function remindOwner(
  state: MockStore,
  principal: Principal,
  control: { id: string; frameworkId: string; owner: string },
  missing: readonly string[],
  at: string
): void {
  state.reminders.push({
    id: `rm-${String(state.reminders.length + 1).padStart(3, '0')}`,
    controlId: control.id,
    frameworkId: control.frameworkId,
    recipient: control.owner,
    reason: 'MISSING_ELEMENTS',
    missing: [...missing],
    message: `The evidence attached to ${control.id} is missing: ${missing.join(', ')}. Please provide an updated document.`,
    createdAt: at,
    expiresAt: null,
    status: 'SENT',
    channel: 'email'
  });
  appendAuditEvent(state.audit, {
    at,
    actor: principal.name,
    action: 'REMINDER_SENT',
    objectType: 'control',
    objectId: control.id,
    detail: { recipient: control.owner, reason: 'MISSING_ELEMENTS', missing }
  });
}

/** Next free validation identifier of the store. */
function nextValidationId(state: MockStore): string {
  return `va-${String(state.validations.length + 1).padStart(3, '0')}`;
}
