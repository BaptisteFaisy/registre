/**
 * Deployed sign-in — EF-ADM-03.
 *
 * On AWS, every route but the public ones sits behind the API Gateway JWT
 * authorizer, so the token a browser carries must be a Cognito ID token. The
 * session route therefore exchanges the login and the password with Cognito
 * (`InitiateAuth`, `USER_PASSWORD_AUTH`) and hands the ID token back as the
 * bearer token: the contract of `POST /v1/auth/session` does not change, only
 * what the token is.
 *
 * `InitiateAuth` is an unsigned public Cognito call, so no SDK and no IAM
 * permission are needed: one HTTPS request. The claims are read from the token
 * Cognito just issued over TLS; every later request is verified by the gateway.
 */

import type { Principal } from '../domain/types.ts';
import { principalFromClaims } from './cognito.ts';
import type { CognitoClaims } from './cognito.ts';

/** Where to sign in: the user-pool client of the portal and its region. */
export interface CognitoSignIn {
  clientId: string;
  region: string;
}

/** A signed-in session: the ID token and its principal. */
export interface CognitoSession {
  token: string;
  principal: Principal;
}

/** Network seam, injectable in tests (CONTRACTS §2.8). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** The deployed sign-in, or `null` when the environment names no Cognito client (offline). */
export function cognitoSignInFromEnv(env: NodeJS.ProcessEnv): CognitoSignIn | null {
  const clientId = env.REGISTRE_COGNITO_CLIENT_ID ?? '';
  const region = env.REGISTRE_REGION ?? env.AWS_REGION ?? '';
  return clientId.length > 0 && region.length > 0 ? { clientId, region } : null;
}

/**
 * Exchanges a login and a password for a Cognito ID token — EF-ADM-03.
 * Returns `null` for wrong credentials or an identity without a known role, so
 * the route answers the same 401 as offline (no detail leaks which one failed).
 */
export async function signInWithCognito(
  signIn: CognitoSignIn,
  login: string,
  password: string,
  fetcher: FetchLike = fetch as unknown as FetchLike
): Promise<CognitoSession | null> {
  const response = await fetcher(`https://cognito-idp.${signIn.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth'
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: signIn.clientId,
      AuthParameters: { USERNAME: login, PASSWORD: password }
    })
  });
  if (!response.ok) return null;
  const payload = JSON.parse(await response.text()) as { AuthenticationResult?: { IdToken?: string } };
  const token = payload.AuthenticationResult?.IdToken;
  if (typeof token !== 'string' || token.length === 0) return null;
  const principal = principalFromClaims(claimsOfToken(token));
  return principal === null ? null : { token, principal };
}

/** Decodes the payload of a JWT without verifying it (the gateway verifies every later call). */
export function claimsOfToken(token: string): CognitoClaims {
  const part = token.split('.')[1] ?? '';
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as CognitoClaims;
  } catch {
    return {};
  }
}
