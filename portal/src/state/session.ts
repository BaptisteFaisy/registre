/**
 * Session persistence: the signed-in principal is kept in `sessionStorage` so
 * a page reload does not log the judges out. No token is stored in production
 * beyond the access token returned by the identity provider.
 */

import type { Principal } from '../api/types.ts';

const PRINCIPAL_KEY = 'registre.principal';
const TOKEN_KEY = 'registre.token';

/** Reads the persisted principal, if any. */
export function loadPrincipal(): Principal | null {
  try {
    const raw = window.sessionStorage.getItem(PRINCIPAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Principal;
  } catch {
    return null;
  }
}

/** Persists the principal and, in HTTP mode, its access token. */
export function savePrincipal(principal: Principal, token: string | null = null): void {
  window.sessionStorage.setItem(PRINCIPAL_KEY, JSON.stringify(principal));
  if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
}

/** Clears the session. */
export function clearSession(): void {
  window.sessionStorage.removeItem(PRINCIPAL_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
}

/** Access token of the current session (HTTP mode only). */
export function currentToken(): string | null {
  return window.sessionStorage.getItem(TOKEN_KEY);
}
