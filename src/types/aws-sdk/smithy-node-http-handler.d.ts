/**
 * Local declarations for `@smithy/node-http-handler` (see ./README.md).
 * Only the request handler used to bound Bedrock/S3 timeouts is declared.
 */

export interface NodeHttpHandlerOptions {
  connectionTimeout?: number;
  requestTimeout?: number;
  socketTimeout?: number;
  httpAgent?: any;
  httpsAgent?: any;
  [key: string]: any;
}

export declare class NodeHttpHandler {
  constructor(options?: NodeHttpHandlerOptions);
  readonly metadata: { handlerName: string };
}
