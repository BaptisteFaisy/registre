import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpAuthApi } from './auth.ts';
import { ApiError } from './client.ts';
import { jsonResponse, stubFetch } from './fetchStub.ts';
import type { Principal } from './types.ts';

const BASE_URL = 'https://api.registre.example';

const PRINCIPAL: Principal = {
  id: 'pr-quality',
  name: 'Amina Diallo',
  email: 'amina.diallo@northwind.example',
  role: 'QUALITY_LEAD',
  clearance: 'RESTRICTED',
  ownedControls: []
};

test('the sign-in posts the credentials and reads the token and the principal', async () => {
  const stub = stubFetch(jsonResponse(200, { token: 'tok-1', principal: PRINCIPAL }));
  const auth = new HttpAuthApi({ baseUrl: BASE_URL, fetchImpl: stub.fetchImpl });

  const session = await auth.signIn('quality@northwind.example', 'demo-quality');
  assert.equal(session.token, 'tok-1');
  assert.equal(session.principal.id, 'pr-quality');

  const call = stub.only();
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/v1/auth/session`);
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.deepEqual(stub.onlyBody(), {
    login: 'quality@northwind.example',
    password: 'demo-quality'
  });
});

test('the sign-out calls the logout route with the bearer token', async () => {
  const stub = stubFetch(new Response(null, { status: 204 }));
  const auth = new HttpAuthApi({
    baseUrl: BASE_URL,
    tokens: { token: () => 'tok-1' },
    fetchImpl: stub.fetchImpl
  });

  await auth.signOut();
  const call = stub.only();
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/v1/auth/logout`);
  assert.equal(call.headers['Authorization'], 'Bearer tok-1');
});

test('a refused sign-in raises an ApiError', async () => {
  const stub = stubFetch(jsonResponse(401, { code: 'UNAUTHORIZED', message: 'Unknown login.' }));
  const auth = new HttpAuthApi({ baseUrl: BASE_URL, fetchImpl: stub.fetchImpl });

  await assert.rejects(
    () => auth.signIn('quality@northwind.example', 'wrong'),
    (error: unknown) => error instanceof ApiError && error.status === 401
  );
});
