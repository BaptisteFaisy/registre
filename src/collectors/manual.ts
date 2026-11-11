/**
 * Manual deposit collector — EF-COL-02: "receive a manual deposit from the
 * portal, with the target control as an option".
 *
 * The portal calls `deposit()` with the bytes and the metadata the user typed;
 * the file is queued and the next `collect()` run hands it to the pipeline, so a
 * manual upload follows exactly the same path as an automated collection
 * (fingerprint, duplicate check, journal, reading).
 */

import type { ControlId } from '../domain/types.ts';
import { badRequest } from '../support/errors.ts';
import type { Clock } from '../ports/index.ts';
import type { CollectedFile, Collector } from './types.ts';
import { collectedFile, contentTypeFor, dayOf, safeName } from './types.ts';

/** What the portal submits for one manual evidence. */
export interface ManualDeposit {
  /** Original file name, kept for display and for the vault key. */
  filename: string;
  bytes: Uint8Array;
  /** Declared content type; guessed from the extension when empty. */
  contentType?: string;
  title?: string;
  /** Control the depositor is aiming at, optional (EF-COL-02). */
  controlId?: ControlId;
  /** Date shown by the source system, cross-checked by the reader (EF-LEC-04). */
  fileDate?: string | null;
  /** Who uploaded the file, journalled with the evidence. */
  submittedBy: string;
  /** Note from the depositor, journalled with the evidence. */
  note?: string;
}

export class ManualCollector implements Collector {
  readonly id = 'collector-manual';
  readonly kind = 'MANUAL' as const;

  private readonly clock: Clock;
  private pending: CollectedFile[] = [];

  /** Builds the deposit queue; `clock` dates the vault keys. */
  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** Validates and queues one deposit; returns the file as it will be stored. */
  deposit(input: ManualDeposit): CollectedFile {
    if (input.filename.trim().length === 0) {
      throw badRequest('manual deposit: a file name is required');
    }
    if (input.submittedBy.trim().length === 0) {
      throw badRequest('manual deposit: the depositor is required', { filename: input.filename });
    }
    const name = safeName(input.filename);
    const now = this.clock.now();
    const file = collectedFile({
      key: `manual/${dayOf(now)}/${name}`,
      uri: `manual://${safeName(input.submittedBy)}/${name}`,
      kind: 'MANUAL',
      contentType:
        input.contentType !== undefined && input.contentType.length > 0
          ? input.contentType
          : contentTypeFor(name),
      bytes: input.bytes,
      collectedAt: now,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.controlId === undefined ? {} : { controlId: input.controlId }),
      fileDate: input.fileDate ?? null,
      metadata: {
        submittedBy: input.submittedBy,
        originalName: input.filename,
        ...(input.note === undefined ? {} : { note: input.note })
      }
    });
    this.pending.push(file);
    return file;
  }

  /** Drains the queue; the pipeline ingests what this returns (EF-COL-02). */
  async collect(): Promise<CollectedFile[]> {
    const files = this.pending;
    this.pending = [];
    return files;
  }

  /** Number of deposits waiting for the next run (portal badge). */
  get queued(): number {
    return this.pending.length;
  }
}
