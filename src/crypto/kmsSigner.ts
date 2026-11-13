/**
 * KMS signer — the production twin of the local Ed25519 signer.
 *
 * The private key never leaves KMS: this module only asks it to sign and to
 * verify. The key is asymmetric (`ECC_NIST_P256`, `SIGN_VERIFY` only — see
 * `infra/lib/vault-stack.ts`), which means a leak of the API credentials lets an
 * attacker sign a pack but not decrypt the vault, and vice versa.
 *
 * Configuration:
 *   `REGISTRE_SIGNING_KEY_ARN` (or `REGISTRE_SIGNING_KEY_ID`) — the KMS key;
 *   `REGISTRE_REGION` — region of the key, same as everything else (ENF-DATA-01).
 *
 * The SDK is imported lazily, so nothing here is loaded by the tests or by the
 * offline demo. Every failure is wrapped as `upstream(...)`: a signing outage
 * must be visible, never silently produce an unsigned pack.
 */

import { createHash } from 'node:crypto';
import type { Signer, SignerOutput } from '../ports/index.ts';
import { configError, upstream } from '../support/errors.ts';

/** Algorithm reported with every signature produced by this signer. */
export const KMS_ALGORITHM = 'KMS-ECDSA-P256';

/** Signing algorithm passed to KMS for an ECC_NIST_P256 key. */
export const KMS_SIGNING_ALGORITHM = 'ECDSA_SHA_256';

export const KEY_ARN_ENV = 'REGISTRE_SIGNING_KEY_ARN';
export const KEY_ID_ENV = 'REGISTRE_SIGNING_KEY_ID';

export interface KmsSignerOptions {
  /** Key id or ARN; defaults to the environment. */
  keyId?: string;
  region?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * SHA-256 of the payload, the message KMS signs. KMS refuses a RAW message over
 * 4 096 bytes (a real pack manifest is larger: seen on the real run); with
 * ECDSA_SHA_256 a RAW message is hashed with SHA-256 anyway, so signing the
 * digest yields the same signature and an offline ECDSA-SHA256 check of the
 * manifest still verifies.
 */
export function digestOf(payload: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(payload).digest());
}

export class KmsSigner implements Signer {
  readonly id = 'kms-signer';

  private readonly keyId: string;
  private readonly region: string;
  private clientPromise: Promise<KmsClient> | null = null;

  constructor(options: KmsSignerOptions = {}) {
    const env = options.env ?? process.env;
    this.keyId = options.keyId ?? env[KEY_ARN_ENV] ?? env[KEY_ID_ENV] ?? '';
    this.region = options.region ?? env.REGISTRE_REGION ?? env.AWS_REGION ?? 'eu-central-1';
    if (this.keyId.trim().length === 0) {
      throw configError(`${KEY_ARN_ENV} (or ${KEY_ID_ENV}) must name the pack signing key`);
    }
  }

  /** Key identifier published with signatures, so a verifier knows what to fetch. */
  get signingKeyId(): string {
    return this.keyId;
  }

  async sign(input: { payload: Uint8Array; purpose: string }): Promise<SignerOutput> {
    const client = await this.client();
    const { SignCommand } = await import('@aws-sdk/client-kms');
    try {
      const response = await client.send(
        new SignCommand({
          KeyId: this.keyId,
          Message: digestOf(input.payload),
          MessageType: 'DIGEST',
          SigningAlgorithm: KMS_SIGNING_ALGORITHM
        })
      );
      const signature = response.Signature;
      if (signature === undefined) {
        throw upstream('KMS returned no signature', { purpose: input.purpose });
      }
      return {
        signature: toBase64(signature),
        keyId: this.keyId,
        algorithm: KMS_ALGORITHM,
        purpose: input.purpose,
        signedAt: new Date().toISOString()
      };
    } catch (error) {
      throw upstream(`KMS sign failed: ${(error as Error).message}`, { purpose: input.purpose });
    }
  }

  async verify(input: {
    payload: Uint8Array;
    signature: string;
    keyId: string;
    algorithm: string;
  }): Promise<boolean> {
    if (input.algorithm !== KMS_ALGORITHM) return false;
    if (input.keyId !== this.keyId) return false;
    const client = await this.client();
    const { VerifyCommand } = await import('@aws-sdk/client-kms');
    try {
      const response = await client.send(
        new VerifyCommand({
          KeyId: this.keyId,
          Message: digestOf(input.payload),
          MessageType: 'DIGEST',
          Signature: fromBase64(input.signature),
          SigningAlgorithm: KMS_SIGNING_ALGORITHM
        })
      );
      return response.SignatureValid === true;
    } catch {
      // A rejected verification is a verdict, not an outage.
      return false;
    }
  }

  /** The DER public key, base64: what a reviewer needs to verify offline. */
  async publicKeyBase64(): Promise<string> {
    const client = await this.client();
    const { GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
    const response = await client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (response.PublicKey === undefined) throw upstream('KMS returned no public key');
    return toBase64(response.PublicKey);
  }

  private client(): Promise<KmsClient> {
    this.clientPromise ??= buildClient(this.region);
    return this.clientPromise;
  }
}

/**
 * Minimal structural type of the KMS client, so no SDK type is loaded here. The
 * phantom `__output` member of each command is what lets `send` be typed.
 */
interface KmsCommand<O> {
  readonly __output?: O;
}

interface KmsClient {
  send<O>(command: KmsCommand<O>, options?: unknown): Promise<O>;
}

async function buildClient(region: string): Promise<KmsClient> {
  const { KMSClient } = await import('@aws-sdk/client-kms');
  return new KMSClient({ region }) as unknown as KmsClient;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/** Builds the signer from the environment, or `null` when no key is configured. */
export function kmsSignerFromEnv(env: NodeJS.ProcessEnv = process.env): KmsSigner | null {
  const keyId = env[KEY_ARN_ENV] ?? env[KEY_ID_ENV];
  if (keyId === undefined || keyId.trim().length === 0) return null;
  return new KmsSigner({ env });
}
