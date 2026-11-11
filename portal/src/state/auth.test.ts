import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionFlow } from './auth.ts';
import { currentToken, loadPrincipal } from './session.ts';
import type { SessionStorageLike } from './session.ts';
import { HttpAuthApi } from '../api/auth.ts';
import { jsonResponse, stubFetch } from '../api/fetchStub.ts';
import type { FetchStub } from '../api/fetchStub.ts';
import { MockAuthApi } from '../mocks/auth.ts';
import { DEMO_ACCOUNTS } from '../mocks/principals.ts';
import type { DemoAccount } from '../mocks/principals.ts';
import type { Principal } from '../api/types.ts';

const BASE_URL = 'https://api.registre.example';

/** In-memory storage standing in for `window.sessionStorage`. */
class MemoryStorage implements SessionStorageLike {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function qualityLeadAccount(): DemoAccount {
  const account = DEMO_ACCOUNTS.find((item) => item.principal.role === 'QUALITY_LEAD');
  assert.ok(account, 'no quality-lead demo account');
  return account;
}

/** The offline flow plus the list of principals it published. */
function offlineFlow(storage: SessionStorageLike, seen: Principal[][]): SessionFlow {
  return new SessionFlow({
    auth: new MockAuthApi(),
    storage,
    onPrincipal: (principal) => {
      if (principal) seen.push([principal]);
      else seen.push([]);
    }
  });
}

test('the offline sign-in keeps the principal and no token', async () => {
  const account = qualityLeadAccount();
  const storage = new MemoryStorage();
  const seen: Principal[][] = [];

  const principal = await offlineFlow(storage, seen).signIn(account.login, account.password);

  assert.equal(principal.id, account.principal.id);
  assert.deepEqual(seen, [[account.principal]]);
  assert.equal(currentToken(storage), null, 'the demonstration issues no token');
  assert.equal(loadPrincipal(storage)?.role, 'QUALITY_LEAD');
});

test('the offline sign-in refuses an unknown login and stores nothing', async () => {
  const storage = new MemoryStorage();
  const seen: Principal[][] = [];
  const flow = offlineFlow(storage, seen);

  await assert.rejects(
    () => flow.signIn('nobody@northwind.example', 'demo-nothing'),
    /Unknown login or password/
  );
  assert.equal(seen.length, 0);
  assert.equal(loadPrincipal(storage), null);
});

test('the offline sign-out clears the session', async () => {
  const account = qualityLeadAccount();
  const storage = new MemoryStorage();
  const seen: Principal[][] = [];
  const flow = offlineFlow(storage, seen);

  await flow.signIn(account.login, account.password);
  await flow.signOut();

  assert.deepEqual(seen.at(-1), [], 'the last published principal is none');
  assert.equal(loadPrincipal(storage), null);
  assert.equal(currentToken(storage), null);
});

test('the real sign-in stores the token the API returns', async () => {
  const account = qualityLeadAccount();
  const storage = new MemoryStorage();
  const stub = stubFetch(jsonResponse(200, { token: 'tok-9', principal: account.principal }));
  const flow = new SessionFlow({ auth: httpAuth(stub, storage), storage, onPrincipal: () => undefined });

  await flow.signIn(account.login, account.password);

  assert.equal(currentToken(storage), 'tok-9');
  assert.equal(loadPrincipal(storage)?.id, account.principal.id);
});

test('a failing logout still ends the local session', async () => {
  const account = qualityLeadAccount();
  const storage = new MemoryStorage();
  const seen: Principal[][] = [];
  const stub = stubFetch((call) =>
    call.url.endsWith('/v1/auth/logout')
      ? jsonResponse(503, { code: 'UPSTREAM', message: 'The identity service is down.' })
      : jsonResponse(200, { token: 'tok-9', principal: account.principal })
  );
  const flow = new SessionFlow({
    auth: httpAuth(stub, storage),
    storage,
    onPrincipal: (principal) => seen.push(principal ? [principal] : [])
  });

  await flow.signIn(account.login, account.password);
  await flow.signOut();

  assert.equal(currentToken(storage), null);
  assert.deepEqual(seen.at(-1), []);
  assert.equal(stub.calls.length, 2, 'the logout route was called once');
  const logout = stub.calls[1];
  assert.equal(logout?.headers['Authorization'], 'Bearer tok-9', 'the logout carries the token');
});

test('an expired session ends without calling the API again', async () => {
  const account = qualityLeadAccount();
  const storage = new MemoryStorage();
  const seen: Principal[][] = [];
  const stub = stubFetch(jsonResponse(200, { token: 'tok-9', principal: account.principal }));
  const flow = new SessionFlow({
    auth: httpAuth(stub, storage),
    storage,
    onPrincipal: (principal) => seen.push(principal ? [principal] : [])
  });

  await flow.signIn(account.login, account.password);
  flow.endSession();

  assert.equal(currentToken(storage), null);
  assert.deepEqual(seen.at(-1), []);
  assert.equal(stub.calls.length, 1, 'no logout request after a 401');
});

function httpAuth(stub: FetchStub, storage: SessionStorageLike): HttpAuthApi {
  return new HttpAuthApi({
    baseUrl: BASE_URL,
    tokens: { token: () => currentToken(storage) },
    fetchImpl: stub.fetchImpl
  });
}
