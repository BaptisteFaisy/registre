/**
 * The local HTTP server — `npm run api`, and the same code path the Lambda
 * handler uses (`src/api/lambda.ts` adapts the event, nothing else changes).
 *
 * Responsibilities: adapt `node:http` to `ApiRequest`, read the body under the
 * configured limit, delegate to the router, stream the response, log the start
 * and stop cleanly on SIGINT/SIGTERM.
 */

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Services } from '../ports/index.ts';
import { demoDirectory } from './auth.ts';
import type { CredentialDirectory } from './auth.ts';
import { EMPTY_BODY, HTTP_METHODS, concatBytes, responseBytes } from './http.ts';
import type { ApiRequest, ApiResponse, HttpMethod } from './http.ts';
import { DEFAULT_MAX_BODY_BYTES, Router, SECURITY_HEADERS } from './router.ts';
import type { RouterOptions } from './router.ts';
import { defaultPipeline } from './pipeline.ts';
import type { PipelineApi } from './pipeline.ts';
import { ROUTES, describeRoutes } from './routes/index.ts';
import { resolveServices } from './services.ts';
import { isGatewayHeader } from './cognito.ts';

/** Default port of the local server. */
export const DEFAULT_PORT = 8787;

/** Default bind address: loopback only, never exposed by accident. */
export const DEFAULT_HOST = '127.0.0.1';

/** Options accepted by `createServer` (everything the router needs, plus a port). */
export interface ServerOptions {
  directory?: CredentialDirectory;
  pipeline?: PipelineApi;
  maxBodyBytes?: number;
  corsOrigins?: readonly string[] | '*';
  extraHeaders?: Record<string, string>;
  port?: number;
  host?: string;
}

/** The assembled server: the router, the HTTP server and the lifecycle calls. */
export interface RegistreServer {
  router: Router;
  server: Server;
  /** Starts listening; resolves with the bound address. */
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  /** Stops accepting connections and closes them. */
  close(): Promise<void>;
}

/** Headers of an `IncomingMessage`, lower-cased, single-valued. */
function headersOf(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    // The local server has no gateway in front of it: an identity header coming
    // from a client would be an impersonation, so it is dropped.
    if (isGatewayHeader(key)) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

/** Query string of the request URL, last value winning. */
function queryOf(url: string): Record<string, string> {
  const index = url.indexOf('?');
  if (index < 0) return {};
  const query: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(url.slice(index + 1))) query[name] = value;
  return query;
}

/** Path of the request URL, without the query string. */
function pathOf(url: string): string {
  const index = url.indexOf('?');
  const path = index < 0 ? url : url.slice(0, index);
  return path.length === 0 ? '/' : path;
}

/**
 * Reads the body, stopping at `limit` bytes. When the payload is larger, the
 * rest is drained (never buffered) and `limit + 1` bytes are returned, so the
 * router answers 413 instead of dropping the connection mid-request.
 */
export async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  for await (const chunk of request) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    total += bytes.byteLength;
    if (overflow) continue;
    if (total > limit) {
      overflow = true;
      continue;
    }
    chunks.push(bytes);
  }
  if (overflow) return new Uint8Array(limit + 1);
  return chunks.length === 0 ? EMPTY_BODY : concatBytes(chunks);
}

/** Adapts an `IncomingMessage` to the transport-neutral request. */
export async function toApiRequest(request: IncomingMessage, limit = DEFAULT_MAX_BODY_BYTES): Promise<ApiRequest> {
  const url = request.url ?? '/';
  const method = (request.method ?? 'GET').toUpperCase() as HttpMethod;
  return {
    method: HTTP_METHODS.includes(method) ? method : 'GET',
    path: pathOf(url),
    query: queryOf(url),
    headers: headersOf(request),
    body: await readBody(request, limit)
  };
}

/** Writes one `ApiResponse` to the socket, streaming when asked. */
async function writeResponse(response: ServerResponse, payload: ApiResponse): Promise<void> {
  response.writeHead(payload.status, { ...SECURITY_HEADERS, ...payload.headers });
  if (payload.stream !== undefined) {
    for await (const chunk of payload.stream) response.write(chunk);
    response.end();
    return;
  }
  const bytes = await responseBytes(payload);
  response.end(bytes.byteLength === 0 ? undefined : Buffer.from(bytes));
}

/** Builds the router over the standard route table. */
export function createRouter(services: Services, options: ServerOptions = {}): Router {
  const routerOptions: RouterOptions = {
    services,
    pipeline: options.pipeline ?? defaultPipeline,
    directory: options.directory ?? demoDirectory(),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    ...(options.corsOrigins === undefined ? {} : { corsOrigins: options.corsOrigins }),
    ...(options.extraHeaders === undefined ? {} : { extraHeaders: options.extraHeaders })
  };
  return new Router(ROUTES, routerOptions);
}

/** Builds the server without starting it (tests bind an ephemeral port). */
export function createServer(services: Services, options: ServerOptions = {}): RegistreServer {
  const router = createRouter(services, options);
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const server = createHttpServer((request, response) => {
    void toApiRequest(request, limit)
      .then((apiRequest) => router.handle(apiRequest))
      .then((payload) => writeResponse(response, payload))
      .catch((error: unknown) => {
        console.error('[api] unhandled failure while writing the response', error);
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('unexpected server error');
      });
  });
  return {
    router,
    server,
    listen: (port = options.port ?? DEFAULT_PORT, host = options.host ?? DEFAULT_HOST) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          const bound = typeof address === 'object' && address !== null ? address.port : port;
          resolve({ port: bound, host });
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
      })
  };
}

/** Reads `PORT` and `HOST` from the environment, with safe defaults. */
export function addressFromEnv(env: NodeJS.ProcessEnv = process.env): { port: number; host: string } {
  const raw = env.PORT;
  const parsed = raw === undefined ? DEFAULT_PORT : Number(raw);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
  return { port, host: env.HOST ?? DEFAULT_HOST };
}

/** Starts the API and wires the shutdown signals; resolves once listening. */
export async function start(options: ServerOptions = {}): Promise<RegistreServer & { port: number; host: string }> {
  const { services, source } = await resolveServices();
  const address = addressFromEnv();
  const instance = createServer(services, { ...address, ...options });
  const bound = await instance.listen(address.port, address.host);
  logStartup(source, bound.port, bound.host, services.settings.region);
  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, closing`);
    void instance.close().then(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return { ...instance, port: bound.port, host: bound.host };
}

/** Startup log: address, bundle source and the served route table. */
export function logStartup(source: string, port: number, host: string, region: string): void {
  console.log(`[api] Registre listening on http://${host}:${port} (services: ${source}, region: ${region})`);
  console.log(`[api] ${ROUTES.length} routes:`);
  for (const line of describeRoutes()) console.log(`[api]   ${line}`);
  console.log(`[api] contract: http://${host}:${port}/openapi.json — health: /healthz`);
}

/** True when this module is the process entry point. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === new URL(`file://${entry}`).href || entry.endsWith('src/api/server.ts');
}

if (isEntryPoint()) {
  start().catch((error: unknown) => {
    console.error('[api] unable to start', error);
    process.exit(1);
  });
}
