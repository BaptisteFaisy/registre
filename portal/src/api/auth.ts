/**
 * Identity calls of the API: `POST /v1/auth/session` and `POST /v1/auth/logout`.
 *
 * The session endpoint answers `{ token, principal }`; the logout endpoint
 * answers 204. Both run through the same `HttpClient` as the business routes,
 * so the base URL and the bearer token are handled in one single place.
 */

import type { Principal } from './types.ts';
import { HttpClient } from './client.ts';
import type { HttpClientOptions } from './client.ts';

/** What the session endpoint hands back: a token and who owns it. */
export interface SessionPayload {
  /** Absent in the offline demonstration, where no server session exists. */
  token: string | null;
  principal: Principal;
}

/** Signs a user in and out. The HTTP API and the offline mock both implement it. */
export interface AuthApi {
  signIn(login: string, password: string): Promise<SessionPayload>;
  signOut(): Promise<void>;
}

/** HTTP identity provider of the Registre API. */
export class HttpAuthApi implements AuthApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  async signIn(login: string, password: string): Promise<SessionPayload> {
    const payload = await this.http.request<{ token?: string; principal: Principal }>('/v1/auth/session', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
    return { token: payload.token ?? null, principal: payload.principal };
  }

  async signOut(): Promise<void> {
    await this.http.request<unknown>('/v1/auth/logout', { method: 'POST' });
  }
}
