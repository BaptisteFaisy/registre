/**
 * Default settings of the mock tenant (EF-ADM-01).
 */

import type { Settings } from '../api/types.ts';

export const DEFAULT_SETTINGS_MOCK: Settings = {
  confidenceThreshold: 0.85,
  reminderLeadDays: 30,
  defaultPeriodicity: 'P1Y',
  region: 'eu-west-3',
  retentionMonths: 24,
  readerModel: 'bedrock-data-automation',
  answerModel: 'bedrock-structured-output',
  reasoningModel: 'bedrock-structured-output',
  guardrailId: 'gr-7f3c21',
  nightlyServiceTier: 'FLEX'
};

/** Human labels of the settings the portal lets an administrator change. */
export const SETTING_LABELS: Record<string, string> = {
  confidenceThreshold: 'Attachment confidence threshold',
  reminderLeadDays: 'Reminder lead time (days)',
  defaultPeriodicity: 'Default periodicity',
  retentionMonths: 'Evidence retention (months)',
  region: 'AWS region',
  readerModel: 'Reader model',
  reasoningModel: 'Reasoning model',
  answerModel: 'Answer model',
  guardrailId: 'Bedrock guardrail',
  nightlyServiceTier: 'Nightly service tier'
};
