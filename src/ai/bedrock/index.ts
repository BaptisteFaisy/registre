/**
 * Bedrock wiring — `createBedrockAi(env, settings)`.
 *
 * This is the ONLY file that knows which knowledge base, guardrail and Data
 * Automation project the deployment uses. Everything below it is an adapter
 * with a narrow constructor, so the eval tooling and the Lambda handlers can
 * build one service at a time when they need to.
 *
 * Nothing here loads the AWS SDK at import time: each adapter imports it inside
 * the call, so `node --test` and the offline demo never touch it.
 */

import type { Settings } from '../../domain/types.ts';
import type { AiServices } from '../types.ts';
import { configError } from '../../support/errors.ts';
import { hasAwsCredentials } from './client.ts';
import { createDataAutomationReader } from './dataAutomationReader.ts';
import { createControlRetriever, createEvidenceRetriever, knowledgeBaseIds } from './knowledgeBase.ts';
import { createStructuredReasoner } from './structuredReasoner.ts';
import { createGuardrail } from './guardrails.ts';
import { createComposer } from './composer.ts';
import { createAnswerComposer } from '../strands/auditorAgent.ts';
import { createCostMeter } from './costs.ts';

export interface BedrockAiOptions {
  /** Model used for the nightly structured batch (defaults to the settings). */
  reasoningModelId?: string;
  /** Overrides `Settings.guardrailId`. */
  guardrailId?: string | null;
  /** Guardrail version; `DRAFT` until the guardrail is published. */
  guardrailVersion?: string;
}

/**
 * Builds the six Bedrock-backed services (EF-LEC-01, EF-RAT-01, EF-QR-01).
 * Throws `CONFIG` when the deployment lacks the identifiers it cannot invent.
 */
export function createBedrockAi(
  env: NodeJS.ProcessEnv,
  settings: Settings,
  options: BedrockAiOptions = {}
): AiServices {
  const ids = knowledgeBaseIds(env);
  if (!ids.frameworks) {
    console.warn('[ai:bedrock] REGISTRE_KB_FRAMEWORKS_ID is empty: control retrieval will fail until it is set');
  }
  if (!ids.evidence) {
    console.warn('[ai:bedrock] REGISTRE_KB_EVIDENCE_ID is empty: evidence search will fail until it is set');
  }
  if (!hasAwsCredentials(env)) {
    console.warn('[ai:bedrock] no AWS credential in the environment: calls will fail until the chain resolves one');
  }
  const guardrailId = options.guardrailId ?? settings.guardrailId;
  if (guardrailId === null || guardrailId === '') {
    console.warn('[ai:bedrock] no guardrail configured: only the local anchoring and PII checks run');
  }
  const costs = createCostMeter();
  return {
    provider: 'bedrock',
    reader: createDataAutomationReader(settings, { env, meter: costs }),
    controlRetriever: createControlRetriever(settings, ids.frameworks, costs),
    evidenceRetriever: createEvidenceRetriever(settings, ids.evidence, costs),
    reasoner: createStructuredReasoner(settings, {
      meter: costs,
      ...(options.reasoningModelId ? { modelId: options.reasoningModelId } : {})
    }),
    composer: createAnswerComposer(env, settings, { meter: costs }),
    guardrail: createGuardrail(settings, {
      guardrailId,
      meter: costs,
      ...(options.guardrailVersion ? { version: options.guardrailVersion } : {})
    }),
    costs
  };
}

/** Fails early when a Bedrock deployment is requested without a region. */
export function assertBedrockReady(settings: Settings): void {
  if (!settings.region) throw configError('bedrock provider requires Settings.region (ENF-DATA-01: EU region)');
}

export {
  createDataAutomationReader,
  createControlRetriever,
  createEvidenceRetriever,
  createStructuredReasoner,
  createGuardrail,
  createComposer,
  createCostMeter
};
export {
  InMemoryCostMeter,
  addCosts,
  guardrailCost,
  priceOf,
  readingCost,
  recordCost,
  retrievalCost,
  roundUsd,
  summariseCosts,
  tokenCost,
  totalBySource
} from './costs.ts';
export type { CostTier, TokenPrice } from './costs.ts';
export { dataAutomationTarget, DATA_AUTOMATION_MODEL_ID } from './dataAutomationApi.ts';
export { knowledgeBaseIds, accessFilter, controlFromMetadata } from './knowledgeBase.ts';
export { groundingBlocked, DEFAULT_GUARDRAIL_VERSION } from './guardrails.ts';
export { LOG_PREFIX } from './dataAutomationReader.ts';
export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  clientConfig,
  createAgentRuntimeClient,
  createRuntimeClient,
  createS3Client,
  hasAwsCredentials,
  requestHandler,
  resolveRegion
} from './client.ts';
export type { ClientOptions, ResolvedClientConfig } from './client.ts';
