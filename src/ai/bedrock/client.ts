/**
 * Shared Bedrock client factory (module `ai`, adapters only).
 *
 * Rules honoured here:
 *  - the AWS SDK is imported lazily, inside the function, so unit tests and the
 *    offline demo never load it (CONTRACTS.md §2.8);
 *  - the region always comes from `Settings.region` (ENF-DATA-01: EU hosting);
 *  - credentials are never passed explicitly: the default AWS provider chain is
 *    used (instance role in Lambda, SSO or env locally).
 *
 * Every adapter of `src/ai/bedrock/` builds its client through this file.
 */

import type { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { S3Client } from '@aws-sdk/client-s3';
import type { NodeHttpHandler } from '@smithy/node-http-handler';
import type { Settings } from '../../domain/types.ts';
import { configError } from '../../support/errors.ts';

/** Retry budget shared by every Bedrock call (transient 429/5xx). */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Timeout of one Bedrock request, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface ClientOptions {
  /** Overrides `Settings.region`; used by the eval tooling only. */
  region?: string;
  maxAttempts?: number;
  /** Local endpoint (LocalStack, tests of the adapter itself). */
  endpoint?: string;
}

/** Region of the deployment: explicit option, then settings, then failure. */
export function resolveRegion(settings: Settings, options: ClientOptions = {}): string {
  const region = options.region ?? settings.region;
  if (!region) throw configError('Bedrock client: no region configured (Settings.region is empty)');
  return region;
}

/** Plain configuration shared by the three clients (no SDK type at rest). */
export interface ResolvedClientConfig {
  region: string;
  maxAttempts: number;
  endpoint?: string;
}

/** Builds the plain configuration object shared by the three clients. */
export function clientConfig(settings: Settings, options: ClientOptions = {}): ResolvedClientConfig {
  return {
    region: resolveRegion(settings, options),
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    ...(options.endpoint ? { endpoint: options.endpoint } : {})
  };
}

/**
 * Request handler with a hard timeout, so a hung call cannot block a Lambda
 * past its own limit (ENF-PERF-01: one reading under two minutes).
 */
export async function requestHandler(timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<NodeHttpHandler> {
  const { NodeHttpHandler } = await import('@smithy/node-http-handler');
  return new NodeHttpHandler({ requestTimeout: timeoutMs, connectionTimeout: 5_000 });
}

/** Lazily loads the runtime client (Converse, Guardrails, async invoke). */
export async function createRuntimeClient(
  settings: Settings,
  options: ClientOptions = {}
): Promise<BedrockRuntimeClient> {
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  return new BedrockRuntimeClient({ ...clientConfig(settings, options), requestHandler: await requestHandler() });
}

/** Lazily loads the Data Automation runtime client (document reading). */
export async function createDataAutomationClient(
  settings: Settings,
  options: ClientOptions = {}
): Promise<BedrockDataAutomationRuntimeClient> {
  const { BedrockDataAutomationRuntimeClient } = await import('@aws-sdk/client-bedrock-data-automation-runtime');
  // Default request handler: this client ships newer smithy types than the shared
  // one, and each status call is short (the polling loop bounds the reading).
  return new BedrockDataAutomationRuntimeClient(clientConfig(settings, options));
}

/** Lazily loads the agent-runtime client (knowledge bases: Retrieve). */
export async function createAgentRuntimeClient(
  settings: Settings,
  options: ClientOptions = {}
): Promise<BedrockAgentRuntimeClient> {
  const { BedrockAgentRuntimeClient } = await import('@aws-sdk/client-bedrock-agent-runtime');
  return new BedrockAgentRuntimeClient({
    ...clientConfig(settings, options),
    requestHandler: await requestHandler()
  });
}

/** Lazily loads an S3 client (Data Automation output bucket, evidence vault). */
export async function createS3Client(settings: Settings, options: ClientOptions = {}): Promise<S3Client> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({ ...clientConfig(settings, options), requestHandler: await requestHandler() });
}

/** True when the runtime looks like it carries AWS credentials (chain check). */
export function hasAwsCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.AWS_ACCESS_KEY_ID ||
      env.AWS_PROFILE ||
      env.AWS_ROLE_ARN ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE
  );
}
