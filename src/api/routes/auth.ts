/**
 * Session routes — demonstration authentication (EF-ADM-03).
 *
 * `POST /v1/auth/session` exchanges a login and a password for the bearer token
 * the rest of the API accepts, and sets the session cookie a browser can reuse.
 * `GET /v1/auth/accounts` lists the demonstration identities **without their
 * passwords**, so the login screen can offer them to a judge; the credentials
 * themselves live in `docs/DEMO.md`.
 *
 * In production the same routes sit in front of Cognito: only the
 * `CredentialDirectory` changes, never the contract (docs/API.md).
 */

import { unauthorized } from '../errors.ts';
import { empty, json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { SESSION_COOKIE, demoToken } from '../auth.ts';
import { requiredString } from '../validate.ts';
import { principalView } from '../views.ts';
import { bodyObject } from './shared.ts';
import { cognitoSignInFromEnv, signInWithCognito } from '../cognitoSession.ts';

/** Cookie attributes shared by the session and its removal. */
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; SameSite=Lax';

/** Sets the session cookie for a browser caller. */
function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${COOKIE_ATTRIBUTES}`;
}

/** Expires the session cookie immediately. */
function clearedCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** `POST /v1/auth/session` — exchange credentials for a token and a principal. */
async function createSession(context: ApiContext): Promise<ApiResponse> {
  const body = bodyObject(context);
  const login = requiredString(body, 'login');
  const password = requiredString(body, 'password');
  const deployed = cognitoSignInFromEnv(process.env);
  if (deployed !== null) {
    const session = await signInWithCognito(deployed, login, password);
    if (session === null) throw unauthorized('unknown login or password', { reason: 'INVALID_CREDENTIALS' });
    return json(200, { token: session.token, principal: principalView(session.principal) }, { 'set-cookie': sessionCookie(session.token) });
  }
  const token = demoToken(login, password);
  const principal = context.directory.authenticate(token);
  if (principal === null) {
    throw unauthorized('unknown login or password', { reason: 'INVALID_CREDENTIALS' });
  }
  return json(200, { token, principal: principalView(principal) }, { 'set-cookie': sessionCookie(token) });
}

/** `POST /v1/auth/logout` — drop the session cookie (204, no body). */
async function endSession(): Promise<ApiResponse> {
  return empty(204, { 'set-cookie': clearedCookie() });
}

/** `GET /v1/auth/accounts` — demonstration identities, never their passwords. */
async function listAccounts(context: ApiContext): Promise<ApiResponse> {
  const accounts = context.directory.list().map((principal) => ({
    login: principal.email,
    role: principal.role,
    name: principal.name
  }));
  return json(200, accounts);
}

/** The three session routes. */
export const authRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/auth/session',
    handler: createSession,
    meta: {
      operationId: 'createSession',
      summary: 'Exchange demonstration credentials for a bearer token',
      tag: 'auth',
      requirement: 'EF-ADM-03',
      roles: 'public',
      requestSchema: 'SessionRequest',
      responseSchema: 'Session',
      errors: [400, 401],
      notes: 'The token is base64url(login:password); it is also set as the registre_session cookie.'
    }
  },
  {
    method: 'POST',
    path: '/v1/auth/logout',
    handler: endSession,
    meta: {
      operationId: 'endSession',
      summary: 'Close the browser session',
      tag: 'auth',
      roles: 'public',
      successStatus: 204,
      errors: [],
      notes: 'Clears the session cookie. No body is returned.'
    }
  },
  {
    method: 'GET',
    path: '/v1/auth/accounts',
    handler: listAccounts,
    meta: {
      operationId: 'listDemoAccounts',
      summary: 'List the demonstration identities, without their passwords',
      tag: 'auth',
      requirement: 'EF-ADM-03',
      roles: 'public',
      responseSchema: 'SessionAccountArray',
      errors: [],
      notes: 'Feeds the login screen of the demonstration portal.'
    }
  }
];
