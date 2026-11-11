/**
 * Session persistence: the signed-in principal is kept in `sessionStorage` so
 * a page reload does not log the judges out. No token is stored in production
 * beyond the access token returned by the identity provider.
 *
 * The storage is injected so the sign-in flow can be unit tested without a DOM.
 */

import type { Principal } from '../api/types.ts';

const PRINCIPAL_KEY = 'registre.principal';
const TOKEN_KEY = 'registre.token';

/** The subset of the Web Storage API the session needs. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser storage, or null where there is none (unit tests, server side). */
export function browserStorage(): SessionStorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads the persisted principal, if any. */
export function loadPrincipal(
  storage: SessionStorageLike | null = browserStorage()
): Principal | null {
  try {
    const raw = storage?.getItem(PRINCIPAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Principal;
  } catch {
    return null;
  }
}

/** Persists the principal and, in HTTP mode, its access token. */
export function savePrincipal(
  principal: Principal,
  token: string | null = null,
  storage: SessionStorageLike | null = browserStorage()
): void {
  storage?.setItem(PRINCIPAL_KEY, JSON.stringify(principal));
  if (token) storage?.setItem(TOKEN_KEY, token);
}

/** Clears the session. */
export function clearSession(storage: SessionStorageLike | null = browserStorage()): void {
  storage?.removeItem(PRINCIPAL_KEY);
  storage?.removeItem(TOKEN_KEY);
}

/** Access token of the current session (HTTP mode only). */
export function currentToken(storage: SessionStorageLike | null = browserStorage()): string | null {
  return storage?.getItem(TOKEN_KEY) ?? null;
}
