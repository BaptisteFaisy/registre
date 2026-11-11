/**
 * Public surface of the `api` module (spec chapter 15).
 *
 * Downstream code imports from here:
 *  - `createServer` / `start` — the local server (`npm run api`);
 *  - `handler` — the API Gateway Lambda entry point;
 *  - `s3Handler` — the S3 collector trigger;
 *  - `ROUTES` / `buildOpenApiDocument` — the route table and its contract.
 */

export { Router, SECURITY_HEADERS, DEFAULT_MAX_BODY_BYTES, compilePath, matchPath, pathSegments } from './router.ts';
export type { RouterOptions } from './router.ts';

export { createRouter, createServer, start, addressFromEnv, DEFAULT_HOST, DEFAULT_PORT } from './server.ts';
export type { RegistreServer, ServerOptions } from './server.ts';

export { handler, toApiRequestFromEvent, toLambdaResult, resetLambdaCache } from './lambda.ts';
export type { LambdaContext, LambdaHttpEvent, LambdaHttpResult } from './lambda.ts';

export { handler as s3Handler, COLLECTOR_PRINCIPAL, contentTypeOf } from './lambdaS3.ts';
export type { S3Event, S3EventRecord, S3RecordOutcome } from './lambdaS3.ts';

export { DemoDirectory, demoDirectory, demoToken, DEMO_IDENTITIES, SESSION_COOKIE } from './auth.ts';
export type { CredentialDirectory, DemoIdentity } from './auth.ts';

export { ROUTES, describeRoutes } from './routes/index.ts';
export { CHAPTER_15_OPERATIONS } from './routes/table.ts';
export { buildOpenApiDocument, documentedOperations } from './openapi.ts';

export { defaultPipeline } from './pipeline.ts';
export type { DecisionOutcome, DecisionRequest, IngestOutcome, IngestRequest, PipelineApi } from './pipeline.ts';

export { createDemoServices } from './demoServices.ts';
export { resolveServices, resetServicesSingleton, servicesSingleton } from './services.ts';

export { ApiError, describeError, errorBody } from './errors.ts';
export type { ApiErrorCode, ErrorDescription } from './errors.ts';
