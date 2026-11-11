/**
 * Ingestion — EF-COL-05 ("calculer l'empreinte de chaque fichier ; écarter les
 * doublons ; garder les versions") and acceptance R8 ("document en double : un
 * seul enregistrement, deux emplacements notés").
 *
 * Order of the chain (spec 11.4): fingerprint → duplicate check → store in the
 * vault with its retention → read → attach → sufficiency → recompute the states
 * of the controls concerned.
 *
 * The steps themselves live in `steps.ts`, so the deployed Step Functions chain
 * and this entry point run the same code. A duplicate never costs a model
 * token: the second location is recorded on the evidence that already exists
 * and the chain stops there.
 */

import type { Evidence } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { observeAttestation } from './drift.ts';
import { unreadable } from '../support/errors.ts';
import { evidenceReviewItem, needsReview } from './queue.ts';
import { fingerprintStep, readStep, attachStep, sufficiencyStep, statesStep } from './steps.ts';
import type { PipelinePayload } from './steps.ts';
import type { IngestInput, IngestResult } from './types.ts';

/**
 * Ingests one document and runs the whole chain — EF-COL-05, EF-LEC-01,
 * EF-RAT-01..05, EF-SUF-01/02, EF-FRA-02 (acceptance R8, R9, R10).
 */
export async function ingestEvidence(
  services: Services,
  input: IngestInput,
  actor: string
): Promise<IngestResult> {
  if (input.bytes.byteLength === 0) throw unreadable('the document is empty: nothing to fingerprint');
  const payload: PipelinePayload = {
    bytes: input.bytes,
    uri: input.uri,
    contentType: input.contentType,
    kind: input.kind,
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    fileDate: input.fileDate ?? null,
    suggestedControlId: input.suggestedControlId ?? null,
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
    ...(input.attestedState === undefined ? {} : { attestedState: input.attestedState })
  };
  const fingerprint = await fingerprintStep(services, payload, actor);
  if (fingerprint.duplicate) return duplicateResult(services, fingerprint.duplicateOf!);

  const staged = { ...payload, ...fingerprint };
  const read = await readStep(services, staged, actor);
  const evidence = read.evidence;
  const attached = await attachStep(services, { ...staged, evidence }, actor);
  const withAttachments = { ...staged, evidence, attachments: attached.attachments };
  const assessed = await sufficiencyStep(services, withAttachments);
  const states = await statesStep(services, withAttachments);
  // A machine attestation is watched: a changed or failed state is reported the
  // same day, not at the next audit (axis 3a).
  if (input.provenance === 'MACHINE_ATTESTATION' && input.attestedState) {
    for (const attachment of attached.attachments.filter((item) => item.supports)) {
      await observeAttestation(services, {
        controlId: attachment.controlId,
        evidenceId: evidence.id,
        attestedState: input.attestedState,
        actor,
        ...(input.refreshPolicy === undefined ? {} : { policy: input.refreshPolicy })
      });
    }
  }
  const review = needsReview(evidence) ? await queueReview(services, evidence) : null;
  return {
    evidence,
    duplicateOf: null,
    attachments: attached.attachments,
    sufficiencies: assessed.sufficiencies,
    statuses: states.statuses,
    validationItems: review ? [review] : []
  };
}

/**
 * The bytes were already known: the evidence keeps its own record and gains
 * one more location — EF-COL-05 (R8). No model call happens here.
 */
async function duplicateResult(services: Services, evidenceId: string): Promise<IngestResult> {
  const evidence = await services.state.getEvidence(evidenceId);
  if (!evidence) throw unreadable(`the evidence ${evidenceId} disappeared while it was being checked`);
  return {
    evidence,
    duplicateOf: evidence.id,
    attachments: [],
    sufficiencies: [],
    statuses: [],
    validationItems: []
  };
}

/** Queues an unreadable, undated or author-less document for a human — EF-LEC-04. */
async function queueReview(services: Services, evidence: Evidence) {
  const item = evidenceReviewItem(evidence, services.clock.now());
  await services.state.putValidation(item);
  return item;
}
