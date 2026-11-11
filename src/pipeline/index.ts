/**
 * Public surface of the pipeline module — the processing chain of spec 11.4,
 * from the collection of a document to the audit pack.
 *
 * The HTTP layer (`src/api/pipeline.ts`) and the demo bind exactly these names;
 * `test/pipeline/**` exercises them with an in-memory `Services` bundle.
 */

export type { DecisionInput, IngestInput, IngestOutcome, IngestResult } from './types.ts';

export { ingestEvidence } from './ingest.ts';
export { retentionDays, vaultKey } from './vault.ts';
export { importFramework } from './import.ts';
export { proposeAttachments, retrieveCandidates } from './attach.ts';
export type { AttachOutcome } from './attach.ts';
export { assessAttachments } from './sufficiency.ts';
export type { SufficiencyOutcome } from './sufficiency.ts';
export {
  PIPELINE_ACTOR,
  recomputeAfterIngest,
  recomputeFramework,
  recomputeFrameworks
} from './states.ts';
export {
  attachStep,
  candidatesStep,
  fingerprintStep,
  readStep,
  statesStep,
  sufficiencyStep
} from './steps.ts';
export type { FingerprintResult, PipelinePayload } from './steps.ts';
export type { FrameworkStates } from './states.ts';
export { decideValidation, listValidationQueue } from './validation.ts';
export { askQuestion } from './ask.ts';
export { assemblePack, verifyArchive } from './pack.ts';
export { DEFAULT_DIGEST_RECIPIENT, runReminders, weeklyDigest } from './reminders.ts';
export {
  attachmentItem,
  evidenceReviewItem,
  needsReview,
  refreshValidationQueue,
  sufficiencyItem
} from './queue.ts';
