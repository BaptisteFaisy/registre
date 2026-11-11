/**
 * Prompt versioning — the system must know which template produced an answer.
 *
 * One constant per prompt family (reading, attachment, sufficiency, answer).
 * A version MUST be incremented as soon as a template in `src/ai/prompts/**`
 * changes: the quality records compare a metric to a `(model, prompt version)`
 * subject, so a silent template change would poison the trend and the
 * automatic degradation rule of `src/pipeline/quality.ts`.
 *
 * Pure data and one stamping helper, no I/O.
 */

import type { ProposedAttachment } from '../ports/index.ts';

/** Version of the reading blueprint (`src/ai/prompts/readerBlueprint.ts`). */
export const READING_PROMPT_VERSION = 'reading-v1';

/** Version of the attachment prompt (`src/ai/prompts/attachment.ts`). */
export const ATTACHMENT_PROMPT_VERSION = 'attachment-v1';

/** Version of the sufficiency prompt (`src/ai/prompts/sufficiency.ts`). */
export const SUFFICIENCY_PROMPT_VERSION = 'sufficiency-v1';

/** Version of the answer prompt (`src/ai/prompts/answer.ts`). */
export const ANSWER_PROMPT_VERSION = 'answer-v1';

/** Every prompt family grouped, keyed like `QualitySubjectKind` plus READING. */
export const PROMPT_VERSIONS = {
  READING: READING_PROMPT_VERSION,
  ATTACHMENT: ATTACHMENT_PROMPT_VERSION,
  SUFFICIENCY: SUFFICIENCY_PROMPT_VERSION,
  ANSWER: ANSWER_PROMPT_VERSION
} as const;

/** One prompt family. */
export type PromptFamily = keyof typeof PROMPT_VERSIONS;

/**
 * An attachment proposal stamped with the prompt version that produced it.
 * `ProposedAttachment` (port) stays minimal; both reasoners return this
 * subtype, and `src/pipeline/attach.ts` copies the stamp onto the persisted
 * `Attachment.promptVersion`.
 */
export interface VersionedAttachmentProposal extends ProposedAttachment {
  promptVersion: string;
}

/** Stamps the attachment prompt version on one proposal (single implementation). */
export function stampAttachmentVersion(proposal: ProposedAttachment): VersionedAttachmentProposal {
  return { ...proposal, promptVersion: ATTACHMENT_PROMPT_VERSION };
}
