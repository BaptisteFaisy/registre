/**
 * Bedrock Data Automation — the ONLY module naming its API (EF-LEC-01).
 *
 * Why isolated: the Data Automation invocation surface moves faster than the
 * rest of Bedrock. When it changes, exactly one small file changes; the reader
 * keeps its orchestration.
 *
 * Shapes confirmed on the first real deployment (eu-central-1, 2026-11-13):
 *  - `InvokeDataAutomationAsync` (bedrock-data-automation-runtime) with the
 *    project ARN, a data-automation profile (`<geo>.data-automation-v1`), the
 *    input object and an output prefix;
 *  - `GetDataAutomationStatus(invocationArn)` polled until `Success` or an
 *    error status; its output URI is the job metadata (`job_metadata.json`),
 *    which points at the standard (and custom) output of each segment.
 */

import type {
  BedrockDataAutomationRuntimeClient,
  InvokeDataAutomationAsyncCommandInput
} from '@aws-sdk/client-bedrock-data-automation-runtime';
import type { S3Client } from '@aws-sdk/client-s3';
import { upstream } from '../../support/errors.ts';

/** Model id used when no project ARN is configured. */
export const DATA_AUTOMATION_MODEL_ID = 'bedrock-data-automation';

/** Polling interval of one reading, in milliseconds. */
export const POLL_INTERVAL_MS = 2_000;

/** Ceiling of one reading (ENF-PERF-01: a reading stays under two minutes). */
export const POLL_TIMEOUT_MS = 110_000;

export interface DataAutomationTarget {
  /** Project ARN (preferred) or the bare model id. */
  modelId: string;
  /** Custom blueprint ARN holding the Annex B field plan. */
  blueprintArn: string;
  /** S3 prefix where Data Automation writes its JSON result. */
  outputS3Uri: string;
  /** Data-automation profile ARN (cross-region profile of the geography). */
  profileArn?: string;
}

/** Reads the Data Automation target from the environment (config, not code). */
export function dataAutomationTarget(
  env: NodeJS.ProcessEnv,
  fallbackModelId = DATA_AUTOMATION_MODEL_ID
): DataAutomationTarget {
  const modelId = env.REGISTRE_BDA_PROJECT_ARN ?? fallbackModelId;
  const profileArn = env.REGISTRE_BDA_PROFILE_ARN ?? profileArnFor(modelId);
  return {
    modelId,
    blueprintArn: env.REGISTRE_BDA_BLUEPRINT_ARN ?? '',
    outputS3Uri: env.REGISTRE_BDA_OUTPUT_URI ?? '',
    ...(profileArn === null ? {} : { profileArn })
  };
}

/**
 * The profile of the project's geography, derived from the project ARN:
 * `arn:aws:bedrock:<region>:<account>:data-automation-profile/<geo>.data-automation-v1`.
 */
export function profileArnFor(projectArn: string): string | null {
  const match = /^arn:aws:bedrock:([a-z0-9-]+):(\d{12}):data-automation-project\//.exec(projectArn);
  if (!match) return null;
  const region = match[1]!;
  const geo = region.startsWith('eu-') ? 'eu' : region.startsWith('us-') ? 'us' : region.split('-')[0]!;
  return `arn:aws:bedrock:${region}:${match[2]}:data-automation-profile/${geo}.data-automation-v1`;
}

/** Body of one asynchronous invocation, built from the target and the input. */
export function invocationInput(inputS3Uri: string, target: DataAutomationTarget): Record<string, unknown> {
  const modelInput: Record<string, unknown> = {
    inputConfiguration: { s3Uri: inputS3Uri },
    outputConfiguration: { s3Uri: target.outputS3Uri }
  };
  if (target.blueprintArn) modelInput.blueprintConfiguration = { blueprintArn: target.blueprintArn };
  return modelInput;
}

/** Output location of one reading; a missing configuration is a hard error. */
export function requireOutputUri(target: DataAutomationTarget): string {
  if (!target.outputS3Uri) {
    throw upstream('Data Automation: no output location configured (REGISTRE_BDA_OUTPUT_URI)', {
      modelId: target.modelId
    });
  }
  return target.outputS3Uri;
}

/** `InvokeDataAutomationAsync` request of one reading (EF-LEC-01). */
export function startInvocationInput(input: {
  inputS3Uri: string;
  target: DataAutomationTarget;
  token?: string;
}): InvokeDataAutomationAsyncCommandInput {
  const { target } = input;
  if (!target.profileArn) {
    throw upstream('Data Automation: no profile ARN (set REGISTRE_BDA_PROJECT_ARN or REGISTRE_BDA_PROFILE_ARN)', {
      modelId: target.modelId
    });
  }
  return {
    inputConfiguration: { s3Uri: input.inputS3Uri },
    outputConfiguration: { s3Uri: requireOutputUri(target) },
    dataAutomationProfileArn: target.profileArn,
    ...(target.modelId.startsWith('arn:')
      ? { dataAutomationConfiguration: { dataAutomationProjectArn: target.modelId, stage: 'LIVE' } }
      : {}),
    ...(target.blueprintArn ? { blueprints: [{ blueprintArn: target.blueprintArn }] } : {}),
    ...(input.token ? { clientToken: input.token } : {})
  };
}

/** Starts one reading and returns its invocation ARN. */
export async function startInvocation(
  client: BedrockDataAutomationRuntimeClient,
  input: { inputS3Uri: string; target: DataAutomationTarget; token?: string }
): Promise<string> {
  const { InvokeDataAutomationAsyncCommand } = await import('@aws-sdk/client-bedrock-data-automation-runtime');
  try {
    const response = await client.send(new InvokeDataAutomationAsyncCommand(startInvocationInput(input)));
    if (!response.invocationArn) throw upstream('Data Automation: no invocation ARN returned');
    return response.invocationArn;
  } catch (error) {
    throw upstream(`Data Automation: start failed: ${(error as Error).message}`, { inputS3Uri: input.inputS3Uri });
  }
}

export interface InvocationState {
  status: 'Completed' | 'Failed' | 'InProgress';
  failureMessage: string | null;
  /** The job metadata (`job_metadata.json`) once the reading succeeded. */
  outputS3Uri: string | null;
}

/** Maps the service status onto the three states the reader knows. */
export function stateOfStatus(status: string | undefined): InvocationState['status'] {
  if (status === 'Success') return 'Completed';
  if (status === 'ServiceError' || status === 'ClientError') return 'Failed';
  return 'InProgress';
}

/** One status read of an invocation. */
export async function getInvocationState(
  client: BedrockDataAutomationRuntimeClient,
  invocationArn: string
): Promise<InvocationState> {
  const { GetDataAutomationStatusCommand } = await import('@aws-sdk/client-bedrock-data-automation-runtime');
  try {
    const response = await client.send(new GetDataAutomationStatusCommand({ invocationArn }));
    return {
      status: stateOfStatus(response.status),
      failureMessage: response.errorMessage ?? response.errorType ?? null,
      outputS3Uri: response.outputConfiguration?.s3Uri ?? null
    };
  } catch (error) {
    throw upstream(`Data Automation: status failed: ${(error as Error).message}`, { invocationArn });
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Polls until the reading ends, or times out (ENF-PERF-01). */
export async function waitForInvocation(
  client: BedrockDataAutomationRuntimeClient,
  invocationArn: string,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<InvocationState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await getInvocationState(client, invocationArn);
    if (state.status !== 'InProgress') return state;
    await delay(POLL_INTERVAL_MS);
  }
  throw upstream('Data Automation: reading timed out', { invocationArn, timeoutMs });
}

/** Reads one JSON object from S3. */
export async function readResultObject(client: S3Client, s3Uri: string): Promise<unknown> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { bucket, key } = parseS3Uri(s3Uri);
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await response.Body?.transformToString();
    if (!body) throw new Error('empty body');
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw upstream(`Data Automation: cannot read result: ${(error as Error).message}`, { s3Uri });
  }
}

/** Where the job metadata says the outputs of the first segment are. */
export function outputPathsOf(metadata: unknown): { standard: string | null; custom: string | null } {
  const root = (metadata ?? {}) as { output_metadata?: Array<{ segment_metadata?: Array<Record<string, unknown>> }> };
  const segment = root.output_metadata?.[0]?.segment_metadata?.[0] ?? {};
  const standard = typeof segment.standard_output_path === 'string' ? segment.standard_output_path : null;
  const custom = typeof segment.custom_output_path === 'string' ? segment.custom_output_path : null;
  return { standard, custom };
}

/**
 * The document result of one reading: the standard output (text, pages), with
 * the custom output's inference result under `custom_output` when a blueprint
 * ran. A metadata file with no output path is returned as is.
 */
export async function readDocumentOutput(client: S3Client, jobMetadataUri: string): Promise<unknown> {
  const metadata = await readResultObject(client, jobMetadataUri);
  const paths = outputPathsOf(metadata);
  if (paths.standard === null) return metadata;
  const standard = (await readResultObject(client, paths.standard)) as Record<string, unknown>;
  if (paths.custom === null) return standard;
  const custom = (await readResultObject(client, paths.custom)) as Record<string, unknown>;
  return { ...standard, custom_output: [custom.inference_result ?? custom] };
}

/** Splits `s3://bucket/key` into its two parts. */
export function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  // The vault suffixes its URIs with `#<versionId>`; Data Automation takes a
  // plain object URI, so the version fragment is not part of the key.
  const match = /^s3:\/\/([^/]+)\/([^#]+)(?:#.*)?$/.exec(s3Uri);
  if (!match) throw upstream(`invalid S3 URI: ${s3Uri}`, { s3Uri });
  return { bucket: match[1]!, key: match[2]! };
}
