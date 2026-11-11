/**
 * Bedrock Data Automation — the ONLY module naming its API (EF-LEC-01).
 *
 * Why isolated: the Data Automation invocation surface moves faster than the
 * rest of Bedrock (model id vs. project ARN, `modelInput` sub-objects). When it
 * changes, exactly one small file changes; the reader keeps its orchestration.
 *
 * Shapes implemented here and to be confirmed against the console on the first
 * real deployment (see the open points in the module report):
 *  - `StartAsyncInvoke(modelId = <project ARN | bedrock-data-automation>)`
 *  - `modelInput = { inputConfiguration, dataAutomationConfiguration,
 *    blueprintConfiguration, outputConfiguration }`
 *  - `GetAsyncInvoke(invocationArn)` polled until `Completed` / `Failed`.
 */

import type { BedrockRuntimeClient, StartAsyncInvokeCommandInput } from '@aws-sdk/client-bedrock-runtime';
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
}

/** Reads the Data Automation target from the environment (config, not code). */
export function dataAutomationTarget(
  env: NodeJS.ProcessEnv,
  fallbackModelId = DATA_AUTOMATION_MODEL_ID
): DataAutomationTarget {
  return {
    modelId: env.REGISTRE_BDA_PROJECT_ARN ?? fallbackModelId,
    blueprintArn: env.REGISTRE_BDA_BLUEPRINT_ARN ?? '',
    outputS3Uri: env.REGISTRE_BDA_OUTPUT_URI ?? ''
  };
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

/** Request body of one reading, built once so it can be asserted in review. */
export function startInvocationInput(input: {
  inputS3Uri: string;
  target: DataAutomationTarget;
  token?: string;
}): StartAsyncInvokeCommandInput {
  return {
    modelId: input.target.modelId,
    modelInput: invocationInput(input.inputS3Uri, input.target) as unknown as NonNullable<
      StartAsyncInvokeCommandInput['modelInput']
    >,
    outputDataConfig: { s3OutputDataConfig: { s3Uri: requireOutputUri(input.target) } },
    ...(input.token ? { clientRequestToken: input.token } : {})
  };
}

/** Starts one reading task and returns its invocation ARN. */
export async function startInvocation(
  client: BedrockRuntimeClient,
  input: { inputS3Uri: string; target: DataAutomationTarget; token?: string }
): Promise<string> {
  const { StartAsyncInvokeCommand } = await import('@aws-sdk/client-bedrock-runtime');
  try {
    const response = await client.send(new StartAsyncInvokeCommand(startInvocationInput(input)));
    if (!response.invocationArn) throw upstream('Data Automation: no invocation ARN returned');
    return response.invocationArn;
  } catch (error) {
    throw upstream(`Data Automation: start failed: ${(error as Error).message}`, { inputS3Uri: input.inputS3Uri });
  }
}

export interface InvocationState {
  status: 'Completed' | 'Failed' | 'InProgress';
  failureMessage: string | null;
  outputS3Uri: string | null;
}

/** Reads the state of one invocation, without waiting. */
export async function getInvocationState(
  client: BedrockRuntimeClient,
  invocationArn: string
): Promise<InvocationState> {
  const { GetAsyncInvokeCommand } = await import('@aws-sdk/client-bedrock-runtime');
  try {
    const response = await client.send(new GetAsyncInvokeCommand({ invocationArn }));
    const status = response.status ?? 'InProgress';
    const output = response.outputDataConfig?.s3OutputDataConfig?.s3Uri ?? null;
    return { status, failureMessage: response.failureMessage ?? null, outputS3Uri: output };
  } catch (error) {
    throw upstream(`Data Automation: status failed: ${(error as Error).message}`, { invocationArn });
  }
}

/** Resolves after `ms` milliseconds (polling only, never in tests). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls one invocation until it completes or the deadline passes
 * (bounded wait: a reading never blocks the pipeline forever, ENF-PERF-01).
 */
export async function waitForInvocation(
  client: BedrockRuntimeClient,
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

/** Fetches the JSON result object written by Data Automation. */
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

/** Splits `s3://bucket/key` into its two parts. */
export function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri);
  if (!match) throw upstream(`invalid S3 URI: ${s3Uri}`, { s3Uri });
  return { bucket: match[1]!, key: match[2]! };
}
