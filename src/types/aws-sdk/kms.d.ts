/**
 * Local declarations for `@aws-sdk/client-kms` (see ./README.md).
 *
 * Only the two operations the pack signer uses are declared: asymmetric sign and
 * verify. The real package is what runs in production; these declarations keep
 * `tsc` inside the five-minute CI budget.
 */

export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `send` infer the output type of a command. */
  readonly __output?: O;
}

export interface KMSClientConfig {
  [key: string]: any;
}

export declare class KMSClient {
  constructor(config?: KMSClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface SignCommandInput {
  KeyId: string;
  Message: Uint8Array;
  MessageType?: 'RAW' | 'DIGEST';
  SigningAlgorithm: string;
  GrantTokens?: string[];
  [key: string]: any;
}

export interface SignCommandOutput {
  KeyId?: string;
  Signature?: Uint8Array;
  SigningAlgorithm?: string;
  [key: string]: any;
}

export declare class SignCommand implements SdkCommand<SignCommandOutput> {
  constructor(input?: SignCommandInput);
  readonly input: SignCommandInput;
  readonly __output?: SignCommandOutput;
}

export interface VerifyCommandInput {
  KeyId: string;
  Message: Uint8Array;
  MessageType?: 'RAW' | 'DIGEST';
  Signature: Uint8Array;
  SigningAlgorithm: string;
  GrantTokens?: string[];
  [key: string]: any;
}

export interface VerifyCommandOutput {
  KeyId?: string;
  SignatureValid?: boolean;
  SigningAlgorithm?: string;
  [key: string]: any;
}

export declare class VerifyCommand implements SdkCommand<VerifyCommandOutput> {
  constructor(input?: VerifyCommandInput);
  readonly input: VerifyCommandInput;
  readonly __output?: VerifyCommandOutput;
}

export interface GetPublicKeyCommandInput {
  KeyId: string;
  [key: string]: any;
}

export interface GetPublicKeyCommandOutput {
  KeyId?: string;
  PublicKey?: Uint8Array;
  SigningAlgorithms?: string[];
  [key: string]: any;
}

export declare class GetPublicKeyCommand implements SdkCommand<GetPublicKeyCommandOutput> {
  constructor(input?: GetPublicKeyCommandInput);
  readonly input: GetPublicKeyCommandInput;
  readonly __output?: GetPublicKeyCommandOutput;
}
