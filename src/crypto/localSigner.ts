/**
 * Local Ed25519 signer — the offline twin of the KMS signer.
 *
 * A pack's manifest is signed so a third party can check it was not altered
 * after being frozen. In production the key lives in KMS and never leaves it
 * (`src/crypto/kmsSigner.ts`); for the offline demo, the tests and the judges'
 * laptops, this signer uses a key held in the environment.
 *
 * Key material, in order:
 *   1. `REGISTRE_SIGNING_KEY` — base64 of a 32-byte Ed25519 seed (stable, so a
 *      signature made today still verifies tomorrow);
 *   2. `REGISTRE_SIGNING_KEY_FILE` — path to a file holding that base64;
 *   3. nothing: an ephemeral key is generated and `keyId` says so, which makes
 *      the signature unverifiable after the process ends. That is honest and
 *      visible, never silent.
 *
 * The secret is never logged and never leaves this module.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Signer, SignerOutput } from '../ports/index.ts';
import { configError } from '../support/errors.ts';
import { sha256Text, shortHash } from '../support/hash.ts';

/** Algorithm reported for this signer. */
export const LOCAL_ALGORITHM = 'ED25519-LOCAL';

/** Environment holding a base64 32-byte Ed25519 seed. */
export const KEY_ENV = 'REGISTRE_SIGNING_KEY';

/** Environment holding the path of a file with that base64 seed. */
export const KEY_FILE_ENV = 'REGISTRE_SIGNING_KEY_FILE';

interface LoadedKey {
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
  keyId: string;
  ephemeral: boolean;
}

/** Derives a stable key id from a public key, safe to publish. */
function keyIdOf(publicKey: ReturnType<typeof createPublicKey>): string {
  const exported = publicKey.export({ type: 'spki', format: 'der' });
  return `local-ed25519-${shortHash(sha256Text(Buffer.from(exported).toString('base64')), 12)}`;
}

/** Reads the seed from the environment, or generates an ephemeral key. */
function loadKey(env: NodeJS.ProcessEnv): LoadedKey {
  const raw = env[KEY_ENV] ?? (env[KEY_FILE_ENV] ? readFileSync(env[KEY_FILE_ENV]!, 'utf8').trim() : '');
  if (raw.trim().length === 0) {
    const generated = generateKeyPairSync('ed25519');
    return {
      privateKey: generated.privateKey,
      publicKey: generated.publicKey,
      keyId: 'ephemeral-unverifiable-after-process-exit',
      ephemeral: true
    };
  }
  let seed: Buffer;
  try {
    seed = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw configError(`${KEY_ENV} is not valid base64`);
  }
  if (seed.length !== 32) {
    throw configError(`${KEY_ENV} must decode to exactly 32 bytes, got ${seed.length}`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8'
  });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, keyId: keyIdOf(publicKey), ephemeral: false };
}

/** Ed25519 signer backed by a local key (tests, demo, judges' laptops). */
export class LocalSigner implements Signer {
  readonly id = 'local-ed25519-signer';
  private readonly key: LoadedKey;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.key = loadKey(env);
  }

  /** Key id published with every signature, so a verifier knows what to fetch. */
  get keyId(): string {
    return this.key.keyId;
  }

  /** True when the key disappears with the process (no configured key). */
  get isEphemeral(): boolean {
    return this.key.ephemeral;
  }

  async sign(input: { payload: Uint8Array; purpose: string }): Promise<SignerOutput> {
    const signature = signBytes(null, Buffer.from(input.payload), this.key.privateKey);
    return {
      signature: signature.toString('base64'),
      keyId: this.key.keyId,
      algorithm: LOCAL_ALGORITHM,
      purpose: input.purpose,
      signedAt: new Date().toISOString()
    };
  }

  async verify(input: {
    payload: Uint8Array;
    signature: string;
    keyId: string;
    algorithm: string;
  }): Promise<boolean> {
    if (input.algorithm !== LOCAL_ALGORITHM) return false;
    if (input.keyId !== this.key.keyId) return false;
    try {
      return verifyBytes(null, Buffer.from(input.payload), this.key.publicKey, Buffer.from(input.signature, 'base64'));
    } catch {
      return false;
    }
  }

  /** Public key in base64 (SPKI), so a reviewer can verify without our API. */
  publicKeyBase64(): string {
    return Buffer.from(this.key.publicKey.export({ type: 'spki', format: 'der' })).toString('base64');
  }
}

/** A signer that refuses to sign: used when signing is explicitly disabled. */
export class NullSigner implements Signer {
  readonly id = 'null-signer';

  async sign(): Promise<SignerOutput> {
    return { signature: '', keyId: 'none', algorithm: 'NONE', purpose: 'pack', signedAt: new Date().toISOString() };
  }

  async verify(): Promise<boolean> {
    return false;
  }
}

/**
 * Chooses the signer from the environment: `REGISTRE_SIGNER=local|kms|none`.
 *
 * The KMS branch is loaded lazily so the offline demo never touches the SDK.
 * `kms` without a key configured is a hard error, never a silent fallback: an
 * operator who asked for KMS signing must not get an unverifiable local key.
 */
export async function signerFromEnvAsync(env: NodeJS.ProcessEnv = process.env): Promise<Signer> {
  const wanted = signerKind(env);
  if (wanted === 'kms') {
    const { kmsSignerFromEnv } = await import('./kmsSigner.ts');
    const signer = kmsSignerFromEnv(env);
    if (signer === null) {
      throw configError('REGISTRE_SIGNER=kms but no signing key is configured', {
        expected: 'REGISTRE_SIGNING_KEY_ARN or REGISTRE_SIGNING_KEY_ID'
      });
    }
    return signer;
  }
  return signerFromEnv(env);
}

/** The configured signer kind, validated. */
export function signerKind(env: NodeJS.ProcessEnv = process.env): 'local' | 'kms' | 'none' {
  const wanted = (env.REGISTRE_SIGNER ?? 'local').trim().toLowerCase();
  if (wanted === 'local' || wanted === 'kms' || wanted === 'none') return wanted;
  throw configError(`REGISTRE_SIGNER must be "local", "kms" or "none", got "${wanted}"`, {
    REGISTRE_SIGNER: wanted
  });
}

/** Synchronous choice, for the offline paths (local or none only). */
export function signerFromEnv(env: NodeJS.ProcessEnv = process.env): Signer {
  const wanted = signerKind(env);
  if (wanted === 'none') return new NullSigner();
  if (wanted === 'local') return new LocalSigner(env);
  throw configError('REGISTRE_SIGNER=kms needs the asynchronous factory signerFromEnvAsync()', {
    REGISTRE_SIGNER: wanted
  });
}
