/**
 * A complete, offline `Services` bundle for the API tests.
 *
 * The API only ever sees the `Services` port bundle, so the suite can wire the
 * real in-memory adapters (`src/store/*`), the real mock AI (`src/ai/mock`) and
 * a tiny in-memory evidence store, and exercise every route with no network.
 */

import type { Control, Evidence } from '../../src/domain/types.ts';
import type { EvidenceStore, Services, StoredObject } from '../../src/ports/index.ts';
import type { Clock } from '../../src/ports/index.ts';
import { createMockAi } from '../../src/ai/mock/index.ts';
import {
  InMemoryAuditSink,
  InMemoryStateStore,
  MemoryCostMeter,
  MemoryNotifier
} from '../../src/store/index.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

/** In-memory `EvidenceStore`: one immutable object per key, no filesystem. */
export class MemoryEvidenceStore implements EvidenceStore {
  readonly id = 'memory-vault';

  private readonly objects = new Map<string, { bytes: Uint8Array; sha256: string; versionId: string }>();
  private version = 0;

  /** Stores one object under its URI, keeping every version addressable. */
  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    retainDays?: number;
  }): Promise<StoredObject> {
    this.version += 1;
    const versionId = `v${this.version}`;
    const sha256 = sha256Bytes(input.bytes);
    const uri = `memory://${input.key}#${versionId}`;
    this.objects.set(uri, { bytes: new Uint8Array(input.bytes), sha256, versionId });
    this.objects.set(`memory://${input.key}`, { bytes: new Uint8Array(input.bytes), sha256, versionId });
    return { uri, versionId, sha256, sizeBytes: input.bytes.byteLength };
  }

  /** Reads one object; an unknown URI is an error, as the vault would be. */
  async get(uri: string): Promise<Uint8Array> {
    const found = this.objects.get(uri);
    if (found === undefined) throw new Error(`memory vault: unknown object ${uri}`);
    return new Uint8Array(found.bytes);
  }

  /** Lists the objects whose URI starts with `prefix`. */
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.entries()]
      .filter(([uri]) => uri.startsWith(prefix))
      .map(([uri, value]) => ({
        uri,
        versionId: value.versionId,
        sha256: value.sha256,
        sizeBytes: value.bytes.byteLength
      }));
  }
}

/** Options of the test bundle. */
export interface TestServicesOptions {
  now?: string;
  /** Freeze time at a fixed instant; the API never calls `new Date()`. */
  clock?: Clock;
  /** Catalogue of the two mock knowledge bases (controls, evidence). */
  catalog?: { controls?: readonly Control[]; evidences?: readonly Evidence[] };
}

/** Builds a fresh, isolated bundle: one per test case, no shared state. */
export function makeTestServices(options: TestServicesOptions = {}): Services {
  const clock = options.clock ?? new FixedClock(options.now ?? TEST_NOW);
  const ai = createMockAi(options.catalog ?? {});
  return {
    clock,
    reader: ai.reader,
    controlRetriever: ai.controlRetriever,
    evidenceRetriever: ai.evidenceRetriever,
    reasoner: ai.reasoner,
    composer: ai.composer,
    guardrail: ai.guardrail,
    costs: new MemoryCostMeter(),
    evidenceStore: new MemoryEvidenceStore(),
    state: new InMemoryStateStore({ clock }),
    audit: new InMemoryAuditSink({ clock }),
    notifier: new MemoryNotifier({ clock }),
    settings: {
      confidenceThreshold: 0.85,
      reminderLeadDays: 30,
      defaultPeriodicity: 'P1Y',
      region: 'eu-central-1',
      retentionMonths: 24,
      readerModel: 'mock-reader',
      reasoningModel: 'mock-reasoner',
      answerModel: 'mock-composer',
      guardrailId: null,
      nightlyServiceTier: 'FLEX'
    }
  };
}
