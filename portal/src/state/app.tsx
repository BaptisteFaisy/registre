/**
 * Application context: the signed-in principal and the API client in use.
 *
 * The client is chosen once at start-up: the offline mock when
 * `VITE_USE_MOCKS=1` (the default in dev), the HTTP client otherwise.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Principal } from '../api/types.ts';
import { HttpRegistreApi } from '../api/client.ts';
import type { RegistreApi } from '../api/client.ts';
import { MockRegistreApi } from '../mocks/client.ts';
import { DEMO_ACCOUNTS, findAccount } from '../mocks/principals.ts';
import { clearSession, currentToken, loadPrincipal, savePrincipal } from './session.ts';

interface AppContextValue {
  principal: Principal | null;
  api: RegistreApi;
  /** True when the portal runs on the offline mock. */
  mocks: boolean;
  /** Demo accounts offered on the sign-in screen (mock mode only). */
  demoAccounts: typeof DEMO_ACCOUNTS;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * `VITE_USE_MOCKS` wins when set (`1`/`true` = mock, `0`/`false` = real API).
 * Otherwise the portal runs on the mock everywhere except when a real API base
 * URL is configured, so a production build always talks to the backend and the
 * demo build never needs one.
 */
export function useMocksFlag(): boolean {
  const raw = import.meta.env.VITE_USE_MOCKS;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return !import.meta.env.VITE_API_URL;
}

/** Builds the client matching the current mode. */
function createApi(mocks: boolean, principalRef: { current: Principal | null }): RegistreApi {
  if (mocks) return new MockRegistreApi(() => principalRef.current);
  return new HttpRegistreApi({
    baseUrl: import.meta.env.VITE_API_URL ?? '/',
    tokens: { token: currentToken }
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mocks = useMocksFlag();
  const [principal, setPrincipal] = useState<Principal | null>(() => loadPrincipal());
  const principalRef = useRef<Principal | null>(principal);
  principalRef.current = principal;
  const api = useMemo(() => createApi(mocks, principalRef), [mocks]);

  const signIn = useCallback(
    async (login: string, password: string) => {
      if (mocks) {
        const account = findAccount(login, password);
        if (!account) throw new Error('Unknown login or password.');
        savePrincipal(account.principal);
        setPrincipal(account.principal);
        return;
      }
      // HTTP mode: the identity endpoint is provided by the Cognito-backed API.
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? '/'}v1/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      if (!response.ok) throw new Error('Sign-in refused.');
      const payload = (await response.json()) as { principal: Principal; token: string };
      savePrincipal(payload.principal, payload.token);
      setPrincipal(payload.principal);
    },
    [mocks]
  );

  const signOut = useCallback(() => {
    clearSession();
    setPrincipal(null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ principal, api, mocks, demoAccounts: DEMO_ACCOUNTS, signIn, signOut }),
    [principal, api, mocks, signIn, signOut]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Access to the session and to the API client. */
export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>.');
  return context;
}

/** The signed-in principal, or a failed assertion (screens behind the login). */
export function usePrincipal(): Principal {
  const { principal } = useApp();
  if (!principal) throw new Error('No signed-in principal.');
  return principal;
}
