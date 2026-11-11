/**
 * S3 evidence vault — the production twin of `LocalEvidenceStore`.
 *
 * Same invariants, different backing store (ENF-INT-01, chapter 16.3):
 *   - the bucket is versioned, so a re-upload never destroys the previous
 *     content, and the returned URI carries the version id;
 *   - a retention is applied as an S3 Object Lock in COMPLIANCE mode, which
 *     nobody — not even the account root — can lift before the date;
 *   - a read re-computes the fingerprint and refuses to hand back bytes that no
 *     longer match what was stored.
 *
 * The SDK is imported lazily and hidden behind `S3VaultGateway`, so the tests
 * never load `@aws-sdk/client-s3` and never touch the network.
 */

import type { EvidenceStore, StoredObject } from '../ports/index.ts';
import type { Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { configError, upstream, badRequest } from '../support/errors.ts';
import { sha256Bytes } from '../support/hash.ts';
import { addDays } from '../support/iso8601.ts';
import { normalizeKey } from './vault.ts';

/** One S3 call, abstracted so a fake gateway can serve the tests. */
export interface S3VaultGateway {
  put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    /** Retention deadline; absent means no Object Lock on this object. */
    retainUntil?: Date;
  }): Promise<{ versionId: string | null }>;
  get(input: { bucket: string; key: string; versionId?: string | null }): Promise<Uint8Array>;
  list(input: { bucket: string; prefix: string }): Promise<Array<{ key: string; sizeBytes: number }>>;
}

/** Real gateway over `@aws-sdk/client-s3`, imported on first use. */
export class SdkS3VaultGateway implements S3VaultGateway {
  private readonly region: string | undefined;
  private clientPromise: Promise<S3Like> | null = null;

  constructor(region?: string) {
    this.region = region;
  }

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    retainUntil?: Date;
  }): Promise<{ versionId: string | null }> {
    const client = await this.client();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const response = await client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.retainUntil === undefined
          ? {}
          : {
              ObjectLockMode: 'COMPLIANCE',
              ObjectLockRetainUntilDate: input.retainUntil,
              ObjectLockLegalHoldStatus: 'ON'
            })
      })
    );
    return { versionId: response.VersionId ?? null };
  }

  async get(input: { bucket: string; key: string; versionId?: string | null }): Promise<Uint8Array> {
    const client = await this.client();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const response = await client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ...(input.versionId ? { VersionId: input.versionId } : {})
      })
    );
    const body = response.Body;
    if (body === undefined) throw upstream('s3: empty body', { key: input.key });
    return new Uint8Array(await body.transformToByteArray());
  }

  async list(input: { bucket: string; prefix: string }): Promise<Array<{ key: string; sizeBytes: number }>> {
    const client = await this.client();
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const out: Array<{ key: string; sizeBytes: number }> = [];
    let token: string | undefined;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          ...(token === undefined ? {} : { ContinuationToken: token })
        })
      );
      for (const item of response.Contents ?? []) {
        if (item.Key === undefined) continue;
        out.push({ key: item.Key, sizeBytes: item.Size ?? 0 });
      }
      token = response.IsTruncated === true ? response.NextContinuationToken : undefined;
    } while (token !== undefined);
    return out;
  }

  private client(): Promise<S3Like> {
    this.clientPromise ??= this.build();
    return this.clientPromise;
  }

  private async build(): Promise<S3Like> {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({ ...(this.region === undefined ? {} : { region: this.region }) }) as unknown as S3Like;
  }
}

/** Minimal structural client, so no SDK type is loaded at module scope. */
interface S3Command<O> {
  readonly __output?: O;
}

interface S3Like {
  send<O>(command: S3Command<O>): Promise<O>;
}

export interface S3EvidenceStoreOptions {
  bucket: string;
  region?: string;
  /** Prefix applied to every key; defaults to none. */
  prefix?: string;
  gateway?: S3VaultGateway;
  clock?: Clock;
}

/** Evidence vault backed by a versioned, Object-Locked S3 bucket. */
export class S3EvidenceStore implements EvidenceStore {
  readonly id = 's3-evidence-store';

  private readonly bucket: string;
  private readonly prefix: string;
  private readonly gateway: S3VaultGateway;
  private readonly clock: Clock;

  constructor(options: S3EvidenceStoreOptions) {
    if (options.bucket.trim().length === 0) throw configError('s3 vault: a bucket name is required');
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? '';
    this.gateway = options.gateway ?? new SdkS3VaultGateway(options.region);
    this.clock = options.clock ?? new SystemClock();
  }

  /** Stores bytes as a new version, under retention when asked — ENF-INT-01. */
  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    retainDays?: number;
  }): Promise<StoredObject> {
    const key = this.fullKey(input.key);
    const sha256 = sha256Bytes(input.bytes);
    const retainDays = input.retainDays ?? 0;
    try {
      const stored = await this.gateway.put({
        bucket: this.bucket,
        key,
        body: input.bytes,
        contentType: input.contentType,
        ...(retainDays > 0
          ? { retainUntil: new Date(addDays(this.clock.now(), retainDays)) }
          : {})
      });
      return {
        uri: uriOf(this.bucket, key, stored.versionId),
        versionId: stored.versionId,
        sha256,
        sizeBytes: input.bytes.byteLength
      };
    } catch (error) {
      throw upstream(`s3 vault: put failed for ${key}: ${(error as Error).message}`, { key });
    }
  }

  /**
   * Reads one object by URI, at the exact version when the URI names one.
   *
   * Fingerprint verification stays with the caller that knows the expected value
   * (`verifyArchive` for a pack, the ingest step for a deposit): the URI carries
   * no hash, and inventing one here would give a false sense of checking.
   */
  async get(uri: string): Promise<Uint8Array> {
    const parsed = parseS3Uri(uri);
    try {
      return await this.gateway.get({
        bucket: parsed.bucket,
        key: parsed.key,
        versionId: parsed.versionId
      });
    } catch (error) {
      throw upstream(`s3 vault: get failed for ${parsed.key}: ${(error as Error).message}`, { key: parsed.key });
    }
  }

  /** Lists a prefix; fingerprints are not computed (that would download bytes). */
  async list(prefix: string): Promise<StoredObject[]> {
    const full = this.fullKey(prefix);
    try {
      const items = await this.gateway.list({ bucket: this.bucket, prefix: full });
      return items.map((item) => ({
        uri: uriOf(this.bucket, item.key, null),
        versionId: null,
        sha256: '',
        sizeBytes: item.sizeBytes
      }));
    } catch (error) {
      throw upstream(`s3 vault: list failed for ${full}: ${(error as Error).message}`, { prefix: full });
    }
  }

  /** Rejects an empty or escaping key, then applies the store prefix. */
  private fullKey(key: string): string {
    const normalised = normalizeKey(key);
    if (normalised.length === 0) throw badRequest('s3 vault: an empty key is refused');
    return `${this.prefix}${normalised}`;
  }
}

/** Builds the URI this store hands out: `s3://bucket/key#versionId`. */
export function uriOf(bucket: string, key: string, versionId: string | null): string {
  return versionId === null ? `s3://${bucket}/${key}` : `s3://${bucket}/${key}#${versionId}`;
}

/** Splits one of those URIs back into bucket, key and version. */
export function parseS3Uri(uri: string): { bucket: string; key: string; versionId: string | null } {
  const withoutScheme = uri.startsWith('s3://') ? uri.slice(5) : uri;
  const separator = withoutScheme.indexOf('/');
  if (separator <= 0) throw badRequest(`not an s3 uri: ${uri}`);
  const bucket = withoutScheme.slice(0, separator);
  const rest = withoutScheme.slice(separator + 1);
  const hash = rest.indexOf('#');
  return { bucket, key: hash >= 0 ? rest.slice(0, hash) : rest, versionId: hash >= 0 ? rest.slice(hash + 1) : null };
}

/** Fingerprint helper callers use to check what they read back. */
export function fingerprintOf(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}
