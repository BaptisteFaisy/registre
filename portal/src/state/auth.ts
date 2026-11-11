/**
 * Sign-in and sign-out flow, free of React and of the DOM.
 *
 * The screens only need a principal; the flow owns the identity provider, the
 * session storage and the reaction to an expired session. Keeping it outside
 * the context makes it unit-testable under `node --test`.
 */

import type { AuthApi } from '../api/auth.ts';
import type { Principal } from '../api/types.ts';
import { browserStorage, clearSession, savePrincipal } from './session.ts';
import type { SessionStorageLike } from './session.ts';

export interface SessionFlowOptions {
  /** Identity provider: the HTTP API, or the offline demo accounts. */
  auth: AuthApi;
  /** Where the principal and the token are kept; null keeps nothing. */
  storage?: SessionStorageLike | null;
  /** Called with the new principal, or null when the session ends. */
  onPrincipal: (principal: Principal | null) => void;
}

/** One session, from the credentials to the stored token and back. */
export class SessionFlow {
  private readonly auth: AuthApi;
  private readonly storage: SessionStorageLike | null;
  private readonly onPrincipal: (principal: Principal | null) => void;

  constructor(options: SessionFlowOptions) {
    this.auth = options.auth;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.onPrincipal = options.onPrincipal;
  }

  /** Signs in, stores the principal and its token, and publishes the principal. */
  async signIn(login: string, password: string): Promise<Principal> {
    const session = await this.auth.signIn(login, password);
    savePrincipal(session.principal, session.token, this.storage);
    this.onPrincipal(session.principal);
    return session.principal;
  }

  /** Signs out: the API is told first, the local session ends anyway. */
  async signOut(): Promise<void> {
    try {
      await this.auth.signOut();
    } catch {
      // Tolerated: the portal must reach the login screen even when the API is
      // unreachable, so a failed logout never keeps a stale local session.
    }
    this.endSession();
  }

  /** Ends the local session without calling the API (session already expired). */
  endSession(): void {
    clearSession(this.storage);
    this.onPrincipal(null);
  }
}
