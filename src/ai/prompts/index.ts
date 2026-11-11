/**
 * Prompt templates, one file per use case (see `CONTRACTS.md` §4, module `ai`).
 *
 * All templates are pure functions returning a string, all of them fence
 * untrusted document text through `wrapUntrusted` (ENF-IA-03), and none of them
 * lets the model produce a state, a date or a count (ENF-IA-04).
 */

export {
  UNTRUSTED_NOTICE,
  UNTRUSTED_TAG,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  QUARANTINE_PREFIX,
  neutraliseInstructions,
  wrapUntrusted,
  hasForgedFence
} from './injection.ts';
export type { NeutralisedText } from './injection.ts';

export {
  EVIDENCE_FIELD_NAMES,
  SUMMARY_MAX_SENTENCES,
  evidenceBlueprint,
  evidenceBlueprintJson,
  blueprintCoversAnnexB
} from './readerBlueprint.ts';
export type { BlueprintField, BlueprintFieldType, EvidenceBlueprint } from './readerBlueprint.ts';

export {
  ATTACHMENT_JSON_CONTRACT,
  ATTACHMENT_OUTPUT_KEYS,
  attachmentEvidenceBlock,
  attachmentPreamble,
  attachmentPrompt,
  renderCandidates,
  renderFields
} from './attachment.ts';
export type { AttachmentEvidenceInput, AttachmentPromptInput } from './attachment.ts';

export {
  SUFFICIENCY_JSON_CONTRACT,
  SUFFICIENCY_OUTPUT_KEYS,
  renderExpected,
  sufficiencyControlBlock,
  sufficiencyEvidenceBlock,
  sufficiencyPrompt
} from './sufficiency.ts';
export type { SufficiencyPromptInput } from './sufficiency.ts';

export {
  ANSWER_CITATION_KEYS,
  ANSWER_JSON_CONTRACT,
  PASSAGE_MAX_CHARS,
  answerPrompt,
  renderPassage,
  renderPassages
} from './answer.ts';
export type { AnswerPromptInput } from './answer.ts';
