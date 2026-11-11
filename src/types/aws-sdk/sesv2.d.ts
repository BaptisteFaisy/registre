/**
 * Local declarations for `@aws-sdk/client-sesv2` (see ./README.md).
 */

export interface SdkCommand<O> {
  readonly input: Record<string, any>;
  /** Phantom member: lets `client.send` infer the output type of a command. */
  readonly __output?: O;
}

export interface SESv2ClientConfig {
  [key: string]: any;
}

export declare class SESv2Client {
  constructor(config?: SESv2ClientConfig);
  readonly config: any;
  send<O>(command: SdkCommand<O>, options?: any): Promise<O>;
  destroy(): void;
}

export interface SendEmailCommandInput {
  [key: string]: any;
}

export interface SendEmailCommandOutput {
  MessageId?: string;
  [key: string]: any;
}

export declare class SendEmailCommand implements SdkCommand<SendEmailCommandOutput> {
  constructor(input?: SendEmailCommandInput);
  readonly input: SendEmailCommandInput;

  readonly __output?: SendEmailCommandOutput;
}
