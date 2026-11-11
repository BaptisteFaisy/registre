/**
 * Entry point of the `ai` module — `createAi(env, settings)`.
 *
 * The product must run twice with the same code: offline (CI, tests, backup
 * video, judges' laptops) and on AWS. `REGISTRE_PROVIDER` selects the
 * implementation:
 *   - unset or `mock`  -> deterministic mocks, no network, no credentials;
 *   - `bedrock`        -> real Bedrock services (Data Automation, knowledge
 *                         bases, structured output, Guardrails, Flex tier);
 *   - anything else    -> explicit `CONFIG` error, never a silent fallback.
 */

import type { Settings } from '../domain/types.ts';
import type { AiProvider, AiServices } from './types.ts';
import { configError } from '../support/errors.ts';
import { createMockAi } from './mock/index.ts';
import type { MockAiOptions } from './mock/index.ts';
import { createBedrockAi } from './bedrock/index.ts';
import type { BedrockAiOptions } from './bedrock/index.ts';

/** Environment variable selecting the implementation. */
export const PROVIDER_ENV = 'REGISTRE_PROVIDER';

/** Provider used when the variable is absent: the offline demo must just work. */
export const DEFAULT_PROVIDER: AiProvider = 'mock';

/**
 * Reads `REGISTRE_PROVIDER` and returns the implementation to build.
 * Pure: no I/O, no defaulting to AWS by accident (CONTRACTS.md §2.8).
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const raw = env[PROVIDER_ENV];
  if (raw === undefined) return DEFAULT_PROVIDER;
  const value = raw.trim().toLowerCase();
  if (value === '') return DEFAULT_PROVIDER;
  if (value === 'mock' || value === 'bedrock') return value;
  throw configError(`${PROVIDER_ENV} must be "mock" or "bedrock", got "${raw}"`, { [PROVIDER_ENV]: raw });
}

export interface CreateAiOptions {
  /** Mock catalogue and script (ignored by the Bedrock provider). */
  mock?: MockAiOptions;
  /** Bedrock overrides (model, guardrail version). */
  bedrock?: BedrockAiOptions;
}

/**
 * Builds the `ai` services for the current environment (EF-LEC-01, EF-RAT-01,
 * EF-QR-01). Sync: the AWS SDK is only imported inside the adapters' calls.
 */
export function createAi(
  env: NodeJS.ProcessEnv,
  settings: Settings,
  options: CreateAiOptions = {}
): AiServices {
  const provider = providerFromEnv(env);
  if (provider === 'bedrock') return createBedrockAi(env, settings, options.bedrock ?? {});
  return createMockAi(options.mock ?? {});
}

export { createMockAi, createBedrockAi };
export type { AiProvider, AiServices } from './types.ts';
export type { MockAiOptions } from './mock/index.ts';
export type { BedrockAiOptions } from './bedrock/index.ts';
export * from './prompts/index.ts';
export {
  ANSWER_JSON_SCHEMA,
  ATTACHMENT_JSON_SCHEMA,
  SUFFICIENCY_JSON_SCHEMA,
  MIN_QUOTE_CHARS,
  isProposedAttachment,
  normaliseConfidence,
  parseAttachmentProposals,
  parseDraftAnswer,
  parseJsonPayload,
  parseSufficiencyElements
} from './schemas.ts';
export type { DraftCitation, ParsedDraftAnswer } from './schemas.ts';
export { citedSpans, isLiterallyAnchored, passagesText, unsupportedSpans } from './anchoring.ts';
export { MIN_QUOTE_SENTENCE_CHARS, bestSentence } from './textMatch.ts';
export type { SentenceMatch } from './textMatch.ts';
export { PII_TOKENS, containsPii, redactPii } from './pii.ts';
export type { RedactionOutcome } from './pii.ts';
export {
  MIN_READABLE_CHARS,
  buildPeriod,
  buildReadFlags,
  inferAccessLevel,
  joinPages,
  normaliseEvidenceType,
  safeDate,
  splitPages,
  summarise
} from './reading.ts';
