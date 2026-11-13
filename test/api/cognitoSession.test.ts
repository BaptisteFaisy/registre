/**
 * Deployed sign-in and the gateway's group claim — EF-ADM-03. No network: the
 * Cognito call goes through an injected fetch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { groupsOf, roleOf } from '../../src/api/cognito.ts';
import { claimsOfToken, cognitoSignInFromEnv, signInWithCognito } from '../../src/api/cognitoSession.ts';
import type { FetchLike } from '../../src/api/cognitoSession.ts';

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

function fakeFetch(status: number, body: unknown): { fetcher: FetchLike; seen: { body?: string; target?: string } } {
  const seen: { body?: string; target?: string } = {};
  const fetcher: FetchLike = async (_url, init) => {
    seen.body = init.body;
    seen.target = init.headers['x-amz-target'];
    return { ok: status === 200, status, text: async () => JSON.stringify(body) };
  };
  return { fetcher, seen };
}

const SIGN_IN = { clientId: 'client-1', region: 'eu-central-1' };

test('EF-ADM-03 the group claim is read in the "[A B]" form API Gateway sends', () => {
  assert.deepEqual(groupsOf({ 'cognito:groups': '[QUALITY_LEAD]' }), ['QUALITY_LEAD']);
  assert.deepEqual(groupsOf({ 'cognito:groups': '[EXECUTIVE ADMIN]' }), ['EXECUTIVE', 'ADMIN']);
  assert.deepEqual(groupsOf({ 'cognito:groups': 'CONTROL_OWNER,ADMIN' }), ['CONTROL_OWNER', 'ADMIN']);
  assert.equal(roleOf({ 'cognito:groups': '[QUALITY_LEAD]' }), 'QUALITY_LEAD');
});

test('EF-ADM-03 the deployed sign-in is configured only when the environment names a client', () => {
  assert.deepEqual(cognitoSignInFromEnv({ REGISTRE_COGNITO_CLIENT_ID: 'client-1', REGISTRE_REGION: 'eu-central-1' }), SIGN_IN);
  assert.equal(cognitoSignInFromEnv({ REGISTRE_REGION: 'eu-central-1' }), null);
});

test('EF-ADM-03 a Cognito sign-in returns the ID token and the principal of its claims', async () => {
  const token = jwt({ sub: 'u-1', email: 'quality.lead@msp.demo', 'cognito:groups': ['QUALITY_LEAD'] });
  const { fetcher, seen } = fakeFetch(200, { AuthenticationResult: { IdToken: token } });
  const session = await signInWithCognito(SIGN_IN, 'quality.lead@msp.demo', 'secret', fetcher);
  assert.equal(session?.token, token);
  assert.equal(session?.principal.role, 'QUALITY_LEAD');
  assert.equal(seen.target, 'AWSCognitoIdentityProviderService.InitiateAuth');
  assert.match(seen.body ?? '', /"AuthFlow":"USER_PASSWORD_AUTH"/);
});

test('EF-ADM-03 wrong credentials and role-less identities are refused alike', async () => {
  assert.equal(await signInWithCognito(SIGN_IN, 'x', 'y', fakeFetch(400, { __type: 'NotAuthorizedException' }).fetcher), null);
  const noRole = jwt({ sub: 'u-2', email: 'nobody@msp.demo' });
  assert.equal(await signInWithCognito(SIGN_IN, 'x', 'y', fakeFetch(200, { AuthenticationResult: { IdToken: noRole } }).fetcher), null);
  assert.deepEqual(claimsOfToken('not-a-jwt'), {});
});
