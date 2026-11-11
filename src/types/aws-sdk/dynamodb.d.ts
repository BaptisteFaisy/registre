/**
 * Local declarations for `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`
 * (see ./README.md). The document client marshals native values, so items are
 * plain records here.
 */

export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `client.send` infer the output type of a command. */
  readonly __output?: O;
}

/** Any marshallable DynamoDB value. */
export type NativeAttributeValue = any;

export interface DynamoDBClientConfig {
  [key: string]: any;
}

export declare class DynamoDBClient {
  constructor(config?: DynamoDBClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface DynamoDBDocumentClientConfig {
  marshallOptions?: { removeUndefinedValues?: boolean; convertEmptyValues?: boolean };
  unmarshallOptions?: { wrapNumbers?: boolean };
  [key: string]: any;
}

export declare class DynamoDBDocumentClient {
  static from(client: any, options?: DynamoDBDocumentClientConfig): DynamoDBDocumentClient;
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface GetCommandInput {
  [key: string]: any;
}

export interface GetCommandOutput {
  Item?: Record<string, NativeAttributeValue>;
  [key: string]: any;
}

export declare class GetCommand implements SdkCommand<GetCommandOutput> {
  constructor(input?: GetCommandInput);
  readonly input: GetCommandInput;

  readonly __output?: GetCommandOutput;
}

export interface PutCommandInput {
  [key: string]: any;
}

export interface PutCommandOutput {
  [key: string]: any;
}

export declare class PutCommand implements SdkCommand<PutCommandOutput> {
  constructor(input?: PutCommandInput);
  readonly input: PutCommandInput;

  readonly __output?: PutCommandOutput;
}

export interface QueryCommandInput {
  [key: string]: any;
}

export interface QueryCommandOutput {
  Items?: Array<Record<string, NativeAttributeValue>>;
  Count?: number;
  LastEvaluatedKey?: Record<string, NativeAttributeValue>;
  [key: string]: any;
}

export declare class QueryCommand implements SdkCommand<QueryCommandOutput> {
  constructor(input?: QueryCommandInput);
  readonly input: QueryCommandInput;

  readonly __output?: QueryCommandOutput;
}

export interface BatchWriteCommandInput {
  [key: string]: any;
}

export interface BatchWriteCommandOutput {
  UnprocessedItems?: Record<string, Array<Record<string, any>>>;
  [key: string]: any;
}

export declare class BatchWriteCommand implements SdkCommand<BatchWriteCommandOutput> {
  constructor(input?: BatchWriteCommandInput);
  readonly input: BatchWriteCommandInput;

  readonly __output?: BatchWriteCommandOutput;
}

export interface BatchGetCommandInput {
  [key: string]: any;
}

export interface BatchGetCommandOutput {
  Responses?: Record<string, Array<Record<string, NativeAttributeValue>>>;
  UnprocessedKeys?: Record<string, any>;
  [key: string]: any;
}

export declare class BatchGetCommand implements SdkCommand<BatchGetCommandOutput> {
  constructor(input?: BatchGetCommandInput);
  readonly input: BatchGetCommandInput;

  readonly __output?: BatchGetCommandOutput;
}

export interface UpdateCommandInput {
  [key: string]: any;
}

export interface UpdateCommandOutput {
  Attributes?: Record<string, NativeAttributeValue>;
  [key: string]: any;
}

export declare class UpdateCommand implements SdkCommand<UpdateCommandOutput> {
  constructor(input?: UpdateCommandInput);
  readonly input: UpdateCommandInput;

  readonly __output?: UpdateCommandOutput;
}
