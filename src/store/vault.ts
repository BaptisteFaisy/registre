/**
 * Local evidence vault — `EvidenceStore` on the file system (ENF-INT-01,
 * chapter 16.3: "fingerprint computed on entry and verified on export;
 * versions kept; objects locked for the retention period").
 *
 * Production uses S3 with versioning and Object Lock; this adapter reproduces
 * the three properties that matter for the demo and the tests:
 *  - a rewrite never overwrites: it appends a new version;
 *  - an object stored with `retainDays > 0` refuses modification and deletion
 *    until its retention date;
 *  - the SHA-256 recorded at write time is re-verified on every read.
 *
 * Layout, one directory per object key:
 *   <root>/objects/<readable-key>-<hash8>/manifest.json   (version ledger)
 *   <root>/objects/<readable-key>-<hash8>/v1.bin, v2.bin  (immutable blobs)
 *
 * Object URIs look like `vault://<key>#<version>`; the fragment is optional and
 * resolves to the latest version when omitted.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { badRequest, conflict, notFound, unreadable } from '../support/errors.ts';
import { sha256Bytes, sha256Text } from '../support/hash.ts';
import { addDays, isBefore } from '../support/iso8601.ts';
import { SystemClock } from '../support/clock.ts';
import type { Clock, EvidenceStore, StoredObject } from '../ports/index.ts';

/** Environment variable overriding the vault root (tests use a temp dir). */
export const VAULT_ROOT_ENV = 'REGISTRE_VAULT_ROOT';
export const DEFAULT_VAULT_ROOT = '.data/vault';

const URI_PREFIX = 'vault://';
const MANIFEST_FILE = 'manifest.json';

/** One stored version of one object. */
export interface VaultVersion {
  versionId: string;
  uri: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  storedAt: string;
  retainDays: number;
  /** End of the legal hold, `null` when the object is not retained. */
  retainUntil: string | null;
}

/** The version ledger of one object key. */
export interface VaultManifest {
  key: string;
  versions: VaultVersion[];
}

export interface LocalVaultOptions {
  /** Root directory; defaults to `$REGISTRE_VAULT_ROOT` then `.data/vault`. */
  root?: string;
  clock?: Clock;
}

/** Vault root resolution order: explicit argument, environment, default. */
export function vaultRootFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env[VAULT_ROOT_ENV] ?? DEFAULT_VAULT_ROOT;
}

/** Rejects keys that would break the URI or escape the vault directory. */
export function normalizeKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) throw badRequest('vault: empty object key');
  if (trimmed.includes('#') || trimmed.includes('\0')) {
    throw badRequest('vault: object key must not contain "#" or NUL', { key });
  }
  if (trimmed.split('/').includes('..')) {
    throw badRequest('vault: object key must not contain ".."', { key });
  }
  return trimmed;
}

/** Readable, collision-free directory name for one key. */
export function objectDirName(key: string): string {
  const readable = key
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${readable.length > 0 ? readable : 'object'}-${sha256Text(key).slice(0, 8)}`;
}

/** Splits `vault://<key>#<version>` into its two parts. */
export function parseVaultUri(uri: string): { key: string; versionId: string | null } {
  if (!uri.startsWith(URI_PREFIX)) throw badRequest(`vault: not a vault URI: ${uri}`);
  const rest = uri.slice(URI_PREFIX.length);
  const separator = rest.indexOf('#');
  if (separator < 0) return { key: normalizeKey(rest), versionId: null };
  const key = normalizeKey(rest.slice(0, separator));
  const versionId = rest.slice(separator + 1).trim();
  if (versionId.length === 0) throw badRequest(`vault: empty version in URI: ${uri}`);
  return { key, versionId };
}

/** True when the version is still under legal hold at `now`. */
export function isRetained(version: VaultVersion, now: string): boolean {
  return version.retainUntil !== null && isBefore(now, version.retainUntil);
}

export class LocalEvidenceStore implements EvidenceStore {
  readonly id = 'local-vault';

  private readonly root: string;
  private readonly clock: Clock;

  /** Builds the vault under `root` (default: the environment, then `.data/vault`). */
  constructor(options: LocalVaultOptions = {}) {
    this.root = options.root ?? vaultRootFromEnv();
    this.clock = options.clock ?? new SystemClock();
  }

  /** Stores new bytes as a new version; refuses a key still under hold. */
  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    retainDays?: number;
  }): Promise<StoredObject> {
    const key = normalizeKey(input.key);
    const manifest = await this.loadManifest(key);
    const now = this.clock.now();
    assertNotRetained(manifest, now);
    const versionId = `v${manifest.versions.length + 1}`;
    const retainDays = input.retainDays ?? 0;
    const version: VaultVersion = {
      versionId,
      uri: `${URI_PREFIX}${key}#${versionId}`,
      sha256: sha256Bytes(input.bytes),
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      storedAt: now,
      retainDays,
      retainUntil: retainDays > 0 ? addDays(now, retainDays) : null
    };
    const directory = this.directoryOf(key);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${versionId}.bin`), input.bytes);
    manifest.versions.push(version);
    await writeFile(join(directory, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
    return { uri: version.uri, versionId, sha256: version.sha256, sizeBytes: version.sizeBytes };
  }

  /** Reads one version (latest when the URI has no fragment) and checks it. */
  async get(uri: string): Promise<Uint8Array> {
    const { key, versionId } = parseVaultUri(uri);
    const manifest = await this.loadManifest(key);
    const version = resolveVersion(manifest, versionId, uri);
    const bytes = await this.readBlob(key, version.versionId, uri);
    if (sha256Bytes(bytes) !== version.sha256) {
      throw unreadable('vault: fingerprint mismatch, object integrity is broken', {
        uri,
        expected: version.sha256,
        actual: sha256Bytes(bytes)
      });
    }
    return bytes;
  }

  /** Latest version of every object whose key starts with `prefix`. */
  async list(prefix: string): Promise<StoredObject[]> {
    const wanted = prefix.trim();
    const manifests = await this.loadAllManifests();
    const out: StoredObject[] = [];
    for (const manifest of manifests) {
      if (!manifest.key.startsWith(wanted)) continue;
      const latest = manifest.versions[manifest.versions.length - 1];
      if (latest === undefined) continue;
      out.push({
        uri: latest.uri,
        versionId: latest.versionId,
        sha256: latest.sha256,
        sizeBytes: latest.sizeBytes
      });
    }
    return out.sort((a, b) => a.uri.localeCompare(b.uri));
  }

  /** Every version of one key, oldest first (EF-COL-05: keep the versions). */
  async versions(key: string): Promise<VaultVersion[]> {
    const manifest = await this.loadManifest(normalizeKey(key));
    return manifest.versions.map((version) => ({ ...version }));
  }

  /** Removes one version; refused while it is under legal hold (ENF-INT-01). */
  async delete(uri: string): Promise<void> {
    const { key, versionId } = parseVaultUri(uri);
    const manifest = await this.loadManifest(key);
    const version = resolveVersion(manifest, versionId, uri);
    const now = this.clock.now();
    if (isRetained(version, now)) {
      throw conflict('vault: object is under legal hold and cannot be deleted', {
        uri,
        retainUntil: version.retainUntil
      });
    }
    await unlink(join(this.directoryOf(key), `${version.versionId}.bin`)).catch(() => undefined);
    manifest.versions = manifest.versions.filter((item) => item.versionId !== version.versionId);
    await writeFile(
      join(this.directoryOf(key), MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  }

  /* ------------------------------------------------------------ private */

  private directoryOf(key: string): string {
    return join(this.root, 'objects', objectDirName(key));
  }

  private async readBlob(key: string, versionId: string, uri: string): Promise<Uint8Array> {
    try {
      const buffer = await readFile(join(this.directoryOf(key), `${versionId}.bin`));
      return new Uint8Array(buffer);
    } catch {
      throw notFound('vault: object bytes are missing', { uri });
    }
  }

  private async loadManifest(key: string): Promise<VaultManifest> {
    try {
      const raw = await readFile(join(this.directoryOf(key), MANIFEST_FILE), 'utf8');
      const parsed = JSON.parse(raw) as VaultManifest;
      return { key: parsed.key, versions: parsed.versions ?? [] };
    } catch {
      return { key, versions: [] };
    }
  }

  private async loadAllManifests(): Promise<VaultManifest[]> {
    let entries: string[];
    try {
      entries = await readdir(join(this.root, 'objects'));
    } catch {
      return [];
    }
    const manifests: VaultManifest[] = [];
    for (const entry of entries) {
      try {
        const raw = await readFile(join(this.root, 'objects', entry, MANIFEST_FILE), 'utf8');
        const parsed = JSON.parse(raw) as VaultManifest;
        manifests.push({ key: parsed.key, versions: parsed.versions ?? [] });
      } catch {
        continue;
      }
    }
    return manifests;
  }
}

/** Refuses any write on a key that still has a retained version. */
function assertNotRetained(manifest: VaultManifest, now: string): void {
  const held = manifest.versions.find((version) => isRetained(version, now));
  if (held !== undefined) {
    throw conflict('vault: object is under legal hold and cannot be modified', {
      key: manifest.key,
      retainUntil: held.retainUntil
    });
  }
}

/** Resolves the requested version, defaulting to the latest one. */
function resolveVersion(manifest: VaultManifest, versionId: string | null, uri: string): VaultVersion {
  const latest = manifest.versions[manifest.versions.length - 1];
  if (latest === undefined) throw notFound('vault: unknown object', { uri });
  if (versionId === null) return latest;
  const found = manifest.versions.find((version) => version.versionId === versionId);
  if (found === undefined) throw notFound('vault: unknown version', { uri, versionId });
  return found;
}
