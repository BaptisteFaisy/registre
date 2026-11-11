/**
 * Local declarations for `@aws-sdk/client-s3` (see ./README.md).
 */

export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `client.send` infer the output type of a command. */
  readonly __output?: O;
}

export interface S3ClientConfig {
  [key: string]: any;
}

export declare class S3Client {
  constructor(config?: S3ClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface S3Object {
  Key?: string;
  Size?: number;
  LastModified?: Date;
  ETag?: string;
  [key: string]: any;
}

export interface GetObjectCommandInput {
  [key: string]: any;
}

export interface GetObjectCommandOutput {
  Body?: {
    transformToByteArray(): Promise<Uint8Array>;
    transformToString(encoding?: string): Promise<string>;
    [key: string]: any;
  };
  ContentType?: string;
  ContentLength?: number;
  LastModified?: Date;
  [key: string]: any;
}

export declare class GetObjectCommand implements SdkCommand<GetObjectCommandOutput> {
  constructor(input?: GetObjectCommandInput);
  readonly input: GetObjectCommandInput;

  readonly __output?: GetObjectCommandOutput;
}

export interface ListObjectsV2CommandInput {
  [key: string]: any;
}

export interface ListObjectsV2CommandOutput {
  Contents?: S3Object[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
  KeyCount?: number;
  [key: string]: any;
}

export declare class ListObjectsV2Command implements SdkCommand<ListObjectsV2CommandOutput> {
  constructor(input?: ListObjectsV2CommandInput);
  readonly input: ListObjectsV2CommandInput;

  readonly __output?: ListObjectsV2CommandOutput;
}

export interface PutObjectCommandInput {
  [key: string]: any;
}

export interface PutObjectCommandOutput {
  ETag?: string;
  VersionId?: string;
  [key: string]: any;
}

export declare class PutObjectCommand implements SdkCommand<PutObjectCommandOutput> {
  constructor(input?: PutObjectCommandInput);
  readonly input: PutObjectCommandInput;

  readonly __output?: PutObjectCommandOutput;
}
