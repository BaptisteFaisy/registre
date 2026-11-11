/**
 * Session routes — EF-ADM-03 (demonstration identities for the judges).
 *
 * `POST /v1/auth/session` exchanges a login and a password for the bearer token
 * the rest of the API accepts, and sets the `registre_session` cookie a browser
 * reuses. `POST /v1/auth/logout` clears that cookie, and `GET /v1/auth/accounts`
 * feeds the login screen with the identities — never with their passwords.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COOKIE, demoDirectory, demoToken } from '../../src/api/auth.ts';
import { openSession } from './fixtures.ts';
import { startTestApi } from './harness.ts';

/** Login and password of the demonstration quality lead. */
const LEAD = { login: 'quality.lead@msp.demo', password: 'quality-demo' };

/** One account of `GET /v1/auth/accounts`. */
interface SessionAccount {
  login: string;
  role: string;
  name: string;
  password?: unknown;
}

test('EF-ADM-03: a session answers a token, a principal and the session cookie', async () => {
  const api = await startTestApi();
  try {
    const response = await openSession(api, LEAD.login, LEAD.password);
    assert.equal(response.status, 200);
    const body = response.json as { token: string; principal: { id: string; role: string; email: string } };
    assert.equal(body.token, demoToken(LEAD.login, LEAD.password));
    assert.equal(body.principal.id, 'u-quality');
    assert.equal(body.principal.role, 'QUALITY_LEAD');
    assert.equal(body.principal.email, LEAD.login);
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.ok(cookie.startsWith(`${SESSION_COOKIE}=${encodeURIComponent(body.token)}`), cookie);
    assert.ok(cookie.includes('HttpOnly'), 'the session cookie is never readable by a script');
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: the token of a session opens a protected route', async () => {
  const api = await startTestApi();
  try {
    const session = await openSession(api, LEAD.login, LEAD.password);
    const token = (session.json as { token: string }).token;
    const bearer = await api.request('GET', '/v1/frameworks', { token });
    assert.equal(bearer.status, 200);
    const cookie = await api.request('GET', '/v1/frameworks', {
      token: null,
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }
    });
    assert.equal(cookie.status, 200, 'the same token is accepted as a session cookie');
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: a wrong password is 401 and sets no cookie', async () => {
  const api = await startTestApi();
  try {
    const response = await openSession(api, LEAD.login, 'not-the-password');
    assert.equal(response.status, 401);
    assert.equal((response.json as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
    assert.equal(response.headers.get('set-cookie'), null);
    const unknown = await openSession(api, 'nobody@msp.demo', LEAD.password);
    assert.equal(unknown.status, 401);
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: an incomplete body is 400 with the missing field', async () => {
  const api = await startTestApi();
  try {
    const noPassword = await api.request('POST', '/v1/auth/session', {
      token: null,
      body: { login: LEAD.login }
    });
    assert.equal(noPassword.status, 400);
    assert.equal((noPassword.json as { error: { detail: { field?: string } } }).error.detail.field, 'password');
    const noLogin = await api.request('POST', '/v1/auth/session', { token: null, body: { password: 'x' } });
    assert.equal(noLogin.status, 400);
    assert.equal((noLogin.json as { error: { detail: { field?: string } } }).error.detail.field, 'login');
    const empty = await api.request('POST', '/v1/auth/session', { token: null });
    assert.equal(empty.status, 400, 'a session needs a JSON body');
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: a logout answers 204 and clears the session cookie', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('POST', '/v1/auth/logout', { token: null });
    assert.equal(response.status, 204);
    assert.equal(response.text, '', 'a logout carries no body');
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.ok(cookie.startsWith(`${SESSION_COOKIE}=;`), cookie);
    assert.ok(cookie.includes('Max-Age=0'), 'the browser drops the cookie at once');
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: the account list is public and holds one line per role', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/auth/accounts', { token: null });
    assert.equal(response.status, 200, 'the login screen needs no credential');
    const accounts = response.json as SessionAccount[];
    const credentials = demoDirectory().demoCredentials();
    assert.equal(accounts.length, credentials.length);
    const roles = accounts.map((account) => account.role).sort();
    assert.deepEqual(roles, ['ADMIN', 'CONTROL_OWNER', 'INTERNAL_AUDITOR', 'QUALITY_LEAD']);
    for (const account of accounts) {
      assert.deepEqual(Object.keys(account).sort(), ['login', 'name', 'role']);
      assert.ok(account.name.length > 0);
      assert.ok(credentials.some((entry) => entry.login === account.login));
    }
  } finally {
    await api.close();
  }
});

test('EF-ADM-03: no password ever leaves the account list', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/auth/accounts', { token: null });
    const accounts = response.json as SessionAccount[];
    for (const account of accounts) {
      assert.equal(account.password, undefined, 'the response carries no password field');
    }
    for (const credential of demoDirectory().demoCredentials()) {
      assert.ok(
        !response.text.includes(credential.password),
        `the password of ${credential.login} must never be served`
      );
    }
  } finally {
    await api.close();
  }
});
