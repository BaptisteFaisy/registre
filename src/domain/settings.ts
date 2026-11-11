/**
 * Deployment settings — EF-ADM-01.
 *
 * Extracted from `types.ts` to stay inside the 500-line budget; re-exported from
 * `types.ts`, so every consumer keeps the same import path.
 */

/* --------------------------------------------------------------- settings */

export interface Settings {
  /** Attachments at or above this confidence are applied without review. */
  confidenceThreshold: number;
  /** Reminders are sent this many days before expiry. */
  reminderLeadDays: number;
  defaultPeriodicity: string;
  region: string;
  retentionMonths: number;
  readerModel: string;
  reasoningModel: string;
  answerModel: string;
  guardrailId: string | null;
  /** Nightly batch runs on the Bedrock Flex service tier. */
  nightlyServiceTier: 'FLEX' | 'STANDARD';
}

export const DEFAULT_SETTINGS: Settings = {
  confidenceThreshold: 0.85,
  reminderLeadDays: 30,
  defaultPeriodicity: 'P1Y',
  region: 'eu-central-1',
  retentionMonths: 24,
  readerModel: 'bedrock-data-automation',
  // EU inference profile, verified invocable in eu-central-1 on 2026-11-11.
  // A bare model id is rejected there ("Invocation ... with on-demand throughput
  // isn't supported"), so the profile prefix is not optional.
  reasoningModel: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  answerModel: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  guardrailId: null,
  nightlyServiceTier: 'FLEX'
};
