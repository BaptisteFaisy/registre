/**
 * Offline identity of the demonstration build.
 *
 * The demo accounts live in `principals.ts`; there is no server session, so no
 * token is issued and the sign-out only clears the local state. The screens see
 * exactly the same `AuthApi` as against the real API.
 */

import type { AuthApi, SessionPayload } from '../api/auth.ts';
import { findAccount } from './principals.ts';

export class MockAuthApi implements AuthApi {
  async signIn(login: string, password: string): Promise<SessionPayload> {
    const account = findAccount(login, password);
    if (!account) throw new Error('Unknown login or password.');
    return { token: null, principal: account.principal };
  }

  async signOut(): Promise<void> {
    // The offline demonstration holds no server session to invalidate.
  }
}
