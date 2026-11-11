/**
 * Local declarations for `@aws-sdk/client-bedrock-agent-runtime` (see ./README.md).
 */

export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `client.send` infer the output type of a command. */
  readonly __output?: O;
}

export interface BedrockAgentRuntimeClientConfig {
  [key: string]: any;
}

export declare class BedrockAgentRuntimeClient {
  constructor(config?: BedrockAgentRuntimeClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface RetrievalFilter {
  [key: string]: any;
}

export interface RetrieveCommandInput {
  [key: string]: any;
}

export interface RetrievalResult {
  content?: { text?: string; [key: string]: any };
  location?: Record<string, any>;
  score?: number;
  metadata?: Record<string, unknown>;
  documentId?: string;
  [key: string]: any;
}

export interface RetrieveCommandOutput {
  retrievalResults?: RetrievalResult[];
  [key: string]: any;
}

export declare class RetrieveCommand implements SdkCommand<RetrieveCommandOutput> {
  constructor(input?: RetrieveCommandInput);
  readonly input: RetrieveCommandInput;

  readonly __output?: RetrieveCommandOutput;
}

export interface RetrieveAndGenerateCommandInput {
  [key: string]: any;
}

export interface RetrieveAndGenerateCommandOutput {
  output?: { text?: string };
  [key: string]: any;
}

export declare class RetrieveAndGenerateCommand implements SdkCommand<RetrieveAndGenerateCommandOutput> {
  constructor(input?: RetrieveAndGenerateCommandInput);
  readonly input: RetrieveAndGenerateCommandInput;

  readonly __output?: RetrieveAndGenerateCommandOutput;
}
