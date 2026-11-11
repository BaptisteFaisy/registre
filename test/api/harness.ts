/**
 * Test harness: a real HTTP server on an ephemeral loopback port, plus helpers
 * to call it with a demonstration credential.
 *
 * Nothing here touches the outside network: the server binds 127.0.0.1 on a
 * port chosen by the OS, and the calls use the global `fetch` against it
 * (CONTRACTS.md §2.8 — the local loopback is allowed, the internet is not).
 */

import type { AddressInfo } from 'node:net';
import type { Services } from '../../src/ports/index.ts';
import { DemoDirectory, demoToken, DEMO_IDENTITIES } from '../../src/api/auth.ts';
import type { CredentialDirectory } from '../../src/api/auth.ts';
import { createServer } from '../../src/api/server.ts';
import type { RegistreServer } from '../../src/api/server.ts';
import type { PipelineApi } from '../../src/api/pipeline.ts';
import { makeTestServices } from './fakeServices.ts';

/** One running test server. */
export interface TestApi {
  services: Services;
  directory: CredentialDirectory;
  server: RegistreServer;
  baseUrl: string;
  /** Issues one request; `body` is JSON-encoded unless it is a string or bytes. */
  request(
    method: string,
    path: string,
    options?: {
      token?: string | null;
      body?: unknown;
      headers?: Record<string, string>;
      raw?: Uint8Array | string;
    }
  ): Promise<TestResponse>;
  close(): Promise<void>;
}

/** A parsed response, with the raw text kept for wording checks. */
export interface TestResponse {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

/** Bearer token of one demonstration identity, by principal id. */
export function tokenOf(principalId: string): string {
  const identity = DEMO_IDENTITIES.find((item) => item.principal.id === principalId);
  if (identity === undefined) throw new Error(`no demonstration identity ${principalId}`);
  return demoToken(identity.principal.email, identity.password);
}

/** Credential helpers, so a test reads `TOKENS.qualityLead` instead of a string. */
export const TOKENS = {
  qualityLead: tokenOf('u-quality'),
  controlOwner: tokenOf('u-owner'),
  auditor: tokenOf('u-auditor'),
  admin: tokenOf('u-admin')
} as const;

/** Parses a response body as JSON when it looks like JSON. */
async function readResponse(response: Response): Promise<TestResponse> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = null;
  }
  return { status: response.status, headers: response.headers, text, json: parsed };
}

/** Starts one API on an ephemeral port. */
export async function startTestApi(options: {
  services?: Services;
  pipeline?: PipelineApi;
  directory?: CredentialDirectory;
  maxBodyBytes?: number;
} = {}): Promise<TestApi> {
  const services = options.services ?? makeTestServices();
  const directory = options.directory ?? new DemoDirectory();
  const server = createServer(services, {
    directory,
    ...(options.pipeline === undefined ? {} : { pipeline: options.pipeline }),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    port: 0
  });
  const { port } = await server.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${port}`;
  const api: TestApi = {
    services,
    directory,
    server,
    baseUrl,
    async request(method, path, requestOptions = {}) {
      const headers: Record<string, string> = { ...requestOptions.headers };
      if (requestOptions.token !== null && requestOptions.token !== undefined) {
        headers.authorization = `Bearer ${requestOptions.token}`;
      }
      let body: string | Uint8Array | undefined;
      if (requestOptions.raw !== undefined) {
        body = requestOptions.raw;
        headers['content-type'] ??= 'application/octet-stream';
      } else if (requestOptions.body !== undefined) {
        body = JSON.stringify(requestOptions.body);
        headers['content-type'] = 'application/json';
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body })
      });
      return readResponse(response);
    },
    close: async () => {
      await server.close();
    }
  };
  return api;
}

/** Port actually bound, for the startup-log test. */
export function boundPort(server: RegistreServer): number {
  const address = server.server.address() as AddressInfo | null;
  return address === null ? 0 : address.port;
}
