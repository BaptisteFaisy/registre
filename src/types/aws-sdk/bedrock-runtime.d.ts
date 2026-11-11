/**
 * Local declarations for `@aws-sdk/client-bedrock-runtime` (see ./README.md).
 * Only the surface used by `src/ai/bedrock/**` is declared; responses carry an
 * index signature so unknown fields still compile.
 */

/** Minimal contract every command satisfies, so `send` can infer the output. */
export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `client.send` infer the output type of a command. */
  readonly __output?: O;
}

export interface BedrockRuntimeClientConfig {
  [key: string]: any;
}

export declare class BedrockRuntimeClient {
  constructor(config?: BedrockRuntimeClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface ConverseContentBlock {
  text?: string;
  [key: string]: any;
}

export interface ConverseCommandInput {
  [key: string]: any;
}

export interface ConverseCommandOutput {
  output?: { message?: { role?: string; content?: ConverseContentBlock[] } };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number };
  [key: string]: any;
}

export declare class ConverseCommand implements SdkCommand<ConverseCommandOutput> {
  constructor(input?: ConverseCommandInput);
  readonly input: ConverseCommandInput;

  readonly __output?: ConverseCommandOutput;
}

export interface ApplyGuardrailCommandInput {
  [key: string]: any;
}

export interface ApplyGuardrailCommandOutput {
  action?: string;
  assessments?: Array<Record<string, any>>;
  outputs?: Array<{ text?: string; type?: string; [key: string]: any }>;
  usage?: { inputTokens?: number; outputTokens?: number };
  [key: string]: any;
}

export declare class ApplyGuardrailCommand implements SdkCommand<ApplyGuardrailCommandOutput> {
  constructor(input?: ApplyGuardrailCommandInput);
  readonly input: ApplyGuardrailCommandInput;

  readonly __output?: ApplyGuardrailCommandOutput;
}

export interface StartAsyncInvokeCommandInput {
  [key: string]: any;
}

export interface StartAsyncInvokeCommandOutput {
  invocationArn?: string;
  [key: string]: any;
}

export declare class StartAsyncInvokeCommand implements SdkCommand<StartAsyncInvokeCommandOutput> {
  constructor(input?: StartAsyncInvokeCommandInput);
  readonly input: StartAsyncInvokeCommandInput;

  readonly __output?: StartAsyncInvokeCommandOutput;
}

export interface GetAsyncInvokeCommandInput {
  [key: string]: any;
}

export interface GetAsyncInvokeCommandOutput {
  /** Data Automation invocation state (the SDK enum has exactly these three). */
  status?: 'InProgress' | 'Completed' | 'Failed';
  failureMessage?: string;
  outputDataConfig?: { s3OutputDataConfig?: { s3Uri?: string } };
  [key: string]: any;
}

export declare class GetAsyncInvokeCommand implements SdkCommand<GetAsyncInvokeCommandOutput> {
  constructor(input?: GetAsyncInvokeCommandInput);
  readonly input: GetAsyncInvokeCommandInput;

  readonly __output?: GetAsyncInvokeCommandOutput;
}

export interface Message {
  [key: string]: any;
}

export interface SystemContentBlock {
  [key: string]: any;
}

export interface GuardrailContentBlock {
  [key: string]: any;
}

export type GuardrailContentSource = string;
