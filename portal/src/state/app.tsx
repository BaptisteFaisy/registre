/**
 * Application context: the signed-in principal and the API client in use.
 *
 * The client is chosen once at start-up: the offline mock when
 * `VITE_USE_MOCKS=1` (the default in dev), the HTTP client otherwise. The
 * session itself — sign-in, sign-out and the reaction to a 401 — lives in
 * `state/auth.ts` so both modes follow the same sequence.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Principal } from '../api/types.ts';
import { HttpRegistreApi } from '../api/client.ts';
import type { RegistreApi } from '../api/client.ts';
import { HttpAuthApi } from '../api/auth.ts';
import type { AuthApi } from '../api/auth.ts';
import { MockRegistreApi } from '../mocks/client.ts';
import { MockAuthApi } from '../mocks/auth.ts';
import { DEMO_ACCOUNTS } from '../mocks/principals.ts';
import { currentToken, loadPrincipal } from './session.ts';
import { SessionFlow } from './auth.ts';

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

/** Base URL of the backend, shared by the business and the identity clients. */
function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL ?? '/';
}

/** Builds the business client matching the current mode. */
function createApi(
  mocks: boolean,
  principalOf: () => Principal | null,
  flowRef: RefObject<SessionFlow | null>
): RegistreApi {
  if (mocks) return new MockRegistreApi(principalOf);
  return new HttpRegistreApi({
    baseUrl: apiBaseUrl(),
    tokens: { token: currentToken },
    // A 401 from any route ends the session and drops back to the login screen.
    onUnauthorized: () => flowRef.current?.endSession()
  });
}

/** Builds the identity client matching the current mode. */
function createAuth(mocks: boolean): AuthApi {
  if (mocks) return new MockAuthApi();
  // The sign-out needs the bearer token, which the session storage still holds
  // when the flow calls it (the local state is cleared afterwards).
  return new HttpAuthApi({ baseUrl: apiBaseUrl(), tokens: { token: currentToken } });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mocks = useMocksFlag();
  const [principal, setPrincipal] = useState<Principal | null>(() => loadPrincipal());
  const principalRef = useRef<Principal | null>(principal);
  principalRef.current = principal;
  const flowRef = useRef<SessionFlow | null>(null);
  const flow = useMemo(
    () => new SessionFlow({ auth: createAuth(mocks), onPrincipal: setPrincipal }),
    [mocks]
  );
  flowRef.current = flow;
  const api = useMemo(() => createApi(mocks, () => principalRef.current, flowRef), [mocks]);

  const signIn = useCallback(
    async (login: string, password: string): Promise<void> => {
      await flow.signIn(login, password);
    },
    [flow]
  );

  const signOut = useCallback(async (): Promise<void> => {
    await flow.signOut();
  }, [flow]);

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
