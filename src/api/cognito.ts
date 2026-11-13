/**
 * Cognito identity — how a JWT validated by API Gateway becomes a `Principal`.
 *
 * Two authentication paths coexist and never overlap:
 *
 *   - **Deployed**: API Gateway validates the Cognito access token and hands the
 *     claims to the Lambda in `requestContext.authorizer.jwt.claims`. The Lambda
 *     translates them into internal `x-registre-*` headers, which only it may
 *     set — `src/api/server.ts` strips those headers from any client request, so
 *     they cannot be spoofed on the local server.
 *   - **Local / demonstration**: the `Authorization: Bearer <token>` demo
 *     credential of `src/api/auth.ts` (EF-ADM-03).
 *
 * The role comes from the Cognito groups the API stack creates (one per role of
 * chapter 6). A token without a known group is refused: no role, no access.
 */

import type { AccessLevel, Principal, Role } from '../domain/types.ts';
import { ROLE_MAX_LEVEL } from '../domain/access.ts';

/** Prefix of the internal headers only the Lambda may set. */
export const GATEWAY_HEADER_PREFIX = 'x-registre-';

/** Internal header carrying the Cognito subject. */
export const HEADER_SUBJECT = 'x-registre-subject';

/** Internal header carrying the verified e-mail. */
export const HEADER_EMAIL = 'x-registre-email';

/** Internal header carrying the display name. */
export const HEADER_NAME = 'x-registre-name';

/** Internal header carrying the Cognito groups, comma separated. */
export const HEADER_GROUPS = 'x-registre-groups';

/** Internal header carrying the controls a CONTROL_OWNER owns. */
export const HEADER_OWNED_CONTROLS = 'x-registre-owned-controls';

/** Every role of chapter 6, as spelled by the Cognito groups. */
export const KNOWN_ROLES: readonly Role[] = [
  'QUALITY_LEAD',
  'CONTROL_OWNER',
  'EXECUTIVE',
  'INTERNAL_AUDITOR',
  'ADMIN'
];

/** The claims this module reads; everything else in the token is ignored. */
export interface CognitoClaims {
  sub?: string;
  email?: string;
  name?: string;
  'cognito:username'?: string;
  'cognito:groups'?: string | string[];
  'custom:ownedControls'?: string;
  [key: string]: unknown;
}

/** True for a header name the gateway owns. */
export function isGatewayHeader(name: string): boolean {
  return name.toLowerCase().startsWith(GATEWAY_HEADER_PREFIX);
}

/** Removes every gateway header from a client-supplied header map. */
export function stripGatewayHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!isGatewayHeader(name)) out[name] = value;
  }
  return out;
}

/** Reads the groups claim, which Cognito sends as a string or an array. */
export function groupsOf(claims: CognitoClaims): string[] {
  const raw = claims['cognito:groups'];
  if (raw === undefined) return [];
  // API Gateway HTTP APIs flatten an array claim into "[A B]": brackets and
  // spaces are separators too, or a deployed caller would have no role at all.
  const list = Array.isArray(raw) ? raw : raw.replace(/^\[|\]$/g, '').split(/[\s,]+/);
  return list.map((group) => String(group).trim()).filter((group) => group.length > 0);
}

/** The first known role of the token, or `null` when it carries none. */
export function roleOf(claims: CognitoClaims): Role | null {
  const groups = groupsOf(claims);
  for (const role of KNOWN_ROLES) {
    if (groups.some((group) => group.toUpperCase() === role)) return role;
  }
  return null;
}

/** Clearance granted by a role; nothing above it is ever readable. */
export function clearanceOf(role: Role): AccessLevel {
  return ROLE_MAX_LEVEL[role];
}

/** Builds the principal of a validated token, or `null` when it has no role. */
export function principalFromClaims(claims: CognitoClaims): Principal | null {
  const role = roleOf(claims);
  if (role === null) return null;
  const email = typeof claims.email === 'string' ? claims.email : '';
  const subject = typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : email;
  if (subject.length === 0) return null;
  const owned =
    typeof claims['custom:ownedControls'] === 'string'
      ? claims['custom:ownedControls']
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
  return {
    id: subject,
    name: typeof claims.name === 'string' && claims.name.length > 0 ? claims.name : subject,
    email,
    role,
    clearance: clearanceOf(role),
    ownedControls: owned
  };
}

/** Internal headers the Lambda adds once the gateway validated the token. */
export function headersFromClaims(claims: CognitoClaims): Record<string, string> {
  const principal = principalFromClaims(claims);
  if (principal === null) return {};
  const headers: Record<string, string> = {
    [HEADER_SUBJECT]: principal.id,
    [HEADER_GROUPS]: principal.role
  };
  if (principal.email.length > 0) headers[HEADER_EMAIL] = principal.email;
  if (principal.name.length > 0) headers[HEADER_NAME] = principal.name;
  if (principal.ownedControls.length > 0) {
    headers[HEADER_OWNED_CONTROLS] = principal.ownedControls.join(',');
  }
  return headers;
}

/** Rebuilds the principal from the internal headers, or `null` when absent. */
export function principalFromGatewayHeaders(headers: Record<string, string>): Principal | null {
  const subject = headers[HEADER_SUBJECT];
  const groups = headers[HEADER_GROUPS];
  if (subject === undefined || groups === undefined) return null;
  const role = KNOWN_ROLES.find((candidate) => candidate === groups.trim().toUpperCase());
  if (role === undefined) return null;
  const owned = headers[HEADER_OWNED_CONTROLS];
  return {
    id: subject,
    name: headers[HEADER_NAME] ?? subject,
    email: headers[HEADER_EMAIL] ?? '',
    role,
    clearance: clearanceOf(role),
    ownedControls: owned === undefined ? [] : owned.split(',').map((item) => item.trim()).filter(Boolean)
  };
}

/** Reads the JWT claims API Gateway v2 places in the request context. */
export function claimsFromEvent(event: {
  requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}): CognitoClaims | null {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  return claims === undefined || claims === null ? null : (claims as CognitoClaims);
}
