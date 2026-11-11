/**
 * Demonstration authentication — EF-ADM-03 ("identifiants de démonstration
 * pour les juges") with the roles of spec chapter 6.
 *
 * A judge receives one line per role: `Authorization: Bearer <token>`, where
 * the token is `base64url(login:password)`. A browser session may instead send
 * the same token in the `registre_session` cookie. In production the same
 * `Principal` is resolved from a Cognito JWT (docs/API.md); only
 * `CredentialDirectory` changes, never the routes.
 *
 * A missing token is 401; a known principal with the wrong role is 403 and is
 * logged as `ACCESS_DENIED` by `requireRole` (src/api/access.ts).
 */

import type { ControlId, Principal, Role } from '../domain/types.ts';
import type { PrincipalDirectory } from '../ports/index.ts';
import { unauthorized } from './errors.ts';
import { principalFromGatewayHeaders } from './cognito.ts';
import { headerOf } from './http.ts';
import type { ApiRequest } from './http.ts';

/** One demonstration identity: who it is, and the password that proves it. */
export interface DemoIdentity {
  principal: Principal;
  password: string;
}

/** Controls the demonstration control owner is responsible for. */
export const DEMO_OWNED_CONTROLS: readonly ControlId[] = ['CONT-01', 'CONT-03'];

/** Name of the session cookie accepted in place of the bearer header. */
export const SESSION_COOKIE = 'registre_session';

/** The four demonstration identities of EF-ADM-03. */
export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  {
    password: 'quality-demo',
    principal: {
      id: 'u-quality',
      name: 'Camille Roy',
      email: 'quality.lead@msp.demo',
      role: 'QUALITY_LEAD',
      clearance: 'RESTRICTED',
      ownedControls: []
    }
  },
  {
    password: 'owner-demo',
    principal: {
      id: 'u-owner',
      name: 'Louis Mercier',
      email: 'control.owner@msp.demo',
      role: 'CONTROL_OWNER',
      clearance: 'INTERNAL',
      ownedControls: [...DEMO_OWNED_CONTROLS]
    }
  },
  {
    password: 'auditor-demo',
    principal: {
      id: 'u-auditor',
      name: 'Inès Fabre',
      email: 'internal.auditor@msp.demo',
      role: 'INTERNAL_AUDITOR',
      clearance: 'INTERNAL',
      ownedControls: []
    }
  },
  {
    password: 'admin-demo',
    principal: {
      id: 'u-admin',
      name: 'Sacha Vidal',
      email: 'admin@msp.demo',
      role: 'ADMIN',
      clearance: 'RESTRICTED',
      ownedControls: []
    }
  }
];

/** Identity used on public routes (`/healthz`, `/openapi.json`): no right at all. */
export const ANONYMOUS_PRINCIPAL: Principal = {
  id: 'anonymous',
  name: 'Anonymous',
  email: 'anonymous@localhost',
  role: 'INTERNAL_AUDITOR',
  clearance: 'PUBLIC',
  ownedControls: []
};

/** A directory that can also verify a credential, not only resolve an id. */
export interface CredentialDirectory extends PrincipalDirectory {
  /** Resolves a token to its principal, or `null` when the token is invalid. */
  authenticate(token: string): Principal | null;
}

/** Encodes a demonstration token as `base64url(login:password)`. */
export function demoToken(login: string, password: string): string {
  return Buffer.from(`${login}:${password}`, 'utf8').toString('base64url');
}

/** Splits `login:password`, decoding the base64url form when there is no colon. */
function credentialPair(token: string): { login: string; password: string } | null {
  const raw = token.includes(':')
    ? token
    : Buffer.from(token, 'base64url').toString('utf8');
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  return { login: raw.slice(0, separator).trim(), password: raw.slice(separator + 1) };
}

/** In-memory directory holding the demonstration identities. */
export class DemoDirectory implements CredentialDirectory {
  private readonly identities: readonly DemoIdentity[];

  constructor(identities: readonly DemoIdentity[] = DEMO_IDENTITIES) {
    this.identities = identities;
  }

  /** Resolves by principal id or e-mail, case-insensitively. */
  resolve(idOrEmail: string): Principal | null {
    const wanted = idOrEmail.trim().toLowerCase();
    const found = this.identities.find(
      (identity) =>
        identity.principal.id.toLowerCase() === wanted || identity.principal.email.toLowerCase() === wanted
    );
    return found === undefined ? null : { ...found.principal, ownedControls: [...found.principal.ownedControls] };
  }

  /** Every principal of the directory. */
  list(): Principal[] {
    return this.identities.map((identity) => ({
      ...identity.principal,
      ownedControls: [...identity.principal.ownedControls]
    }));
  }

  /** The judge-facing credential sheet of EF-ADM-03. */
  demoCredentials(): Array<{ login: string; password: string; principalId: string; role: Role }> {
    return this.identities.map((identity) => ({
      login: identity.principal.email,
      password: identity.password,
      principalId: identity.principal.id,
      role: identity.principal.role
    }));
  }

  /** Verifies a token and returns the matching principal. */
  authenticate(token: string): Principal | null {
    const pair = credentialPair(token);
    if (pair === null) return null;
    const wanted = pair.login.toLowerCase();
    const found = this.identities.find(
      (identity) =>
        identity.password === pair.password &&
        (identity.principal.id.toLowerCase() === wanted || identity.principal.email.toLowerCase() === wanted)
    );
    return found === undefined ? null : this.resolve(found.principal.id);
  }
}

/** The demonstration directory (EF-ADM-03). */
export function demoDirectory(): DemoDirectory {
  return new DemoDirectory();
}

/** Reads one cookie value from the `cookie` header. */
export function cookieValue(request: ApiRequest, name: string): string | null {
  const raw = headerOf(request, 'cookie');
  if (raw === undefined) return null;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

/** The credential carried by the request: bearer header first, then cookie. */
export function tokenFromRequest(request: ApiRequest): string | null {
  const authorization = headerOf(request, 'authorization');
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match !== null) {
      const token = (match[1] ?? '').trim();
      if (token.length > 0) return token;
    }
  }
  return cookieValue(request, SESSION_COOKIE);
}

/**
 * Authenticates a request or throws 401 (EF-ADM-03).
 *
 * Order matters: a token already validated by API Gateway (Cognito) arrives as
 * internal `x-registre-*` headers that only the Lambda can set — the local
 * server strips them from client input. The demonstration directory is the
 * fallback, so the same code runs deployed and offline.
 */
export function authenticate(request: ApiRequest, directory: CredentialDirectory): Principal {
  const fromGateway = principalFromGatewayHeaders(request.headers);
  if (fromGateway !== null) return fromGateway;
  const token = tokenFromRequest(request);
  if (token === null) {
    throw unauthorized('no credential: send "Authorization: Bearer <token>" or the session cookie');
  }
  const principal = directory.authenticate(token);
  if (principal === null) throw unauthorized('unknown or invalid credential', { reason: 'INVALID_TOKEN' });
  return principal;
}
