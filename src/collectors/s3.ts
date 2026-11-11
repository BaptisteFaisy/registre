/**
 * S3 collector — EF-COL-01: "collect the documents of an S3 bucket".
 *
 * The S3 client is reached through `S3Lister`, a two-method port. Tests inject a
 * fake lister (no network, CONTRACTS.md rule 8); production uses
 * `s3ListerFromSdk`, which imports `@aws-sdk/client-s3` lazily on first use.
 *
 * Each run is bounded (`maxObjects`) so a huge bucket cannot blow the 5-minute
 * CI/batch budget, and the returned files are pure bytes plus provenance: the
 * fingerprint is computed by `collectedFile`, never here.
 */

import type { Clock } from '../ports/index.ts';
import { upstream } from '../support/errors.ts';
import type { CollectedFile, Collector, CollectorCursor } from './types.ts';
import { collectedFile, contentTypeFor, dayOf, safeName } from './types.ts';

/** One object as returned by a listing. */
export interface S3ObjectRef {
  key: string;
  sizeBytes: number;
  /** ISO-8601 last-modified, `null` when the source does not expose it. */
  lastModified: string | null;
}

export interface S3Page {
  objects: S3ObjectRef[];
  nextToken?: string;
}

export interface S3ListInput {
  bucket: string;
  prefix: string;
  continuationToken?: string;
  maxKeys?: number;
}

export interface S3ObjectPayload {
  bytes: Uint8Array;
  contentType: string;
}

/** The two S3 calls the collector needs (port, so tests stay offline). */
export interface S3Lister {
  list(input: S3ListInput): Promise<S3Page>;
  /** Downloads one object with its declared content type. */
  get(input: { bucket: string; key: string }): Promise<S3ObjectPayload>;
}

export interface S3CollectorOptions {
  bucket: string;
  prefix: string;
  clock: Clock;
  id?: string;
  /** Injected in tests; omitted in production where the SDK is used. */
  lister?: S3Lister;
  region?: string;
  /** Hard bound of one run (EF-PERF-01). */
  maxObjects?: number;
}

/** Vault key of one S3 object: readable, and safe for the vault directory. */
export function s3ObjectKey(bucket: string, objectKey: string): string {
  const segments = objectKey.split('/').filter((segment) => segment.length > 0).map(safeName);
  return ['s3', safeName(bucket), ...segments].join('/');
}

export class S3Collector implements Collector {
  readonly id: string;
  readonly kind = 'S3' as const;

  private readonly options: S3CollectorOptions;
  private readonly maxObjects: number;
  private cached: S3Lister | null = null;

  /** Builds the collector; the lister is injected in tests only. */
  constructor(options: S3CollectorOptions) {
    this.options = options;
    this.id = options.id ?? 'collector-s3';
    this.maxObjects = options.maxObjects ?? 100;
  }

  /** Lists the prefix and downloads each object, bounded by `maxObjects`. */
  async collect(cursor?: CollectorCursor): Promise<CollectedFile[]> {
    const lister = await this.lister();
    const page = await lister.list({
      bucket: this.options.bucket,
      prefix: this.options.prefix,
      ...(cursor?.token === undefined ? {} : { continuationToken: cursor.token }),
      maxKeys: this.maxObjects
    });
    const selected = page.objects
      .filter((object) => withinPeriod(object.lastModified, cursor))
      .slice(0, this.maxObjects);
    const files: CollectedFile[] = [];
    for (const object of selected) {
      const payload = await lister.get({ bucket: this.options.bucket, key: object.key });
      files.push(this.toCollectedFile(object, payload));
    }
    return files;
  }

  /** Resolves the injected lister, or the lazily built SDK one. */
  private async lister(): Promise<S3Lister> {
    if (this.options.lister !== undefined) return this.options.lister;
    this.cached ??= s3ListerFromSdk(this.options.region ?? 'eu-west-3');
    return this.cached;
  }

  private toCollectedFile(object: S3ObjectRef, payload: S3ObjectPayload): CollectedFile {
    const name = object.key.split('/').pop() ?? object.key;
    return collectedFile({
      key: s3ObjectKey(this.options.bucket, object.key),
      uri: `s3://${this.options.bucket}/${object.key}`,
      kind: 'S3',
      contentType: payload.contentType.length > 0 ? payload.contentType : contentTypeFor(name),
      bytes: payload.bytes,
      collectedAt: this.options.clock.now(),
      title: name,
      fileDate: object.lastModified === null ? null : dayOf(object.lastModified),
      metadata: {
        bucket: this.options.bucket,
        objectKey: object.key,
        sizeBytes: String(object.sizeBytes),
        ...(object.lastModified === null ? {} : { lastModified: object.lastModified })
      }
    });
  }
}

/** True when the object date falls inside the cursor window. */
function withinPeriod(lastModified: string | null, cursor: CollectorCursor | undefined): boolean {
  if (lastModified === null || cursor === undefined) return true;
  if (cursor.since !== undefined && lastModified < cursor.since) return false;
  if (cursor.until !== undefined && lastModified > cursor.until) return false;
  return true;
}

/* ------------------------------------------------------------- SDK side */

/** Typed view of the SDK module, imported lazily and cached once. */
type LibS3 = typeof import('@aws-sdk/client-s3');
type S3Connection = { lib: LibS3; client: import('@aws-sdk/client-s3').S3Client };

/** Connects on first use, then reuses the client for the life of the lister. */
function lazyConnection(region: string): () => Promise<S3Connection> {
  let ready: Promise<S3Connection> | null = null;
  return () => {
    ready ??= (async () => {
      const lib = await import('@aws-sdk/client-s3');
      return { lib, client: new lib.S3Client({ region }) };
    })();
    return ready;
  };
}

/**
 * Real S3 lister. The SDK is imported on first call only, so importing this
 * module never pulls `@aws-sdk/client-s3` into an offline test run.
 */
export function s3ListerFromSdk(region: string): S3Lister {
  const connect = lazyConnection(region);
  return {
    list: (input) => listObjects(connect, input),
    get: (input) => getObject(connect, input)
  };
}

async function listObjects(connect: () => Promise<S3Connection>, input: S3ListInput): Promise<S3Page> {
  const { lib, client } = await connect();
  try {
    const response = await client.send(
      new lib.ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        ...(input.continuationToken === undefined
          ? {}
          : { ContinuationToken: input.continuationToken }),
        ...(input.maxKeys === undefined ? {} : { MaxKeys: input.maxKeys })
      })
    );
    const objects = (response.Contents ?? []).map((item) => ({
      key: item.Key ?? '',
      sizeBytes: item.Size ?? 0,
      lastModified: item.LastModified?.toISOString() ?? null
    }));
    return {
      objects,
      ...(response.NextContinuationToken === undefined
        ? {}
        : { nextToken: response.NextContinuationToken })
    };
  } catch (error) {
    throw upstream('s3: listing objects failed', {
      bucket: input.bucket,
      prefix: input.prefix,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function getObject(
  connect: () => Promise<S3Connection>,
  input: { bucket: string; key: string }
): Promise<S3ObjectPayload> {
  const { lib, client } = await connect();
  try {
    const response = await client.send(
      new lib.GetObjectCommand({ Bucket: input.bucket, Key: input.key })
    );
    if (response.Body === undefined) {
      throw upstream('s3: empty body', { bucket: input.bucket, key: input.key });
    }
    const bytes = await response.Body.transformToByteArray();
    return { bytes: new Uint8Array(bytes), contentType: response.ContentType ?? '' };
  } catch (error) {
    throw upstream('s3: downloading an object failed', {
      bucket: input.bucket,
      key: input.key,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
