/**
 * Shapes shared by the processing chain (spec 11.4, chapter 14).
 *
 * Declared here rather than in each step so `src/pipeline/index.ts` re-exports
 * one public contract, and so the API layer and the demo never rebuild them.
 */

import type { EvidenceProvenance } from '../domain/verification.ts';
import type { RefreshPolicy } from '../domain/quality.ts';
import type {
  Attachment,
  ControlStatus,
  Evidence,
  EvidenceId,
  Sufficiency,
  ValidationDecision,
  ValidationItem
} from '../domain/types.ts';

/** A document handed to the chain by a collector or a manual deposit — EF-COL-02/05. */
export interface IngestInput {
  bytes: Uint8Array;
  contentType: string;
  /** Where the bytes come from; journalled as provenance. */
  uri: string;
  kind: 'S3' | 'MANUAL' | 'ITSM' | 'AWS_REPORT';
  fileName?: string;
  /** File-level date, cross-checked against the document date (EF-LEC-04). */
  fileDate?: string | null;
  /** Control the depositor targets, when the source knows it (EF-COL-02). */
  suggestedControlId?: string | null;
  /**
   * A collector's dated report is a machine attestation: it is refreshed on its
   * own cadence and can drift (axis 3a). Absent means a human document.
   */
  provenance?: EvidenceProvenance;
  /** The state the collector observed, compared run over run. */
  attestedState?: string | null;
  /** Expected cadence of the collector; defaults to one run a day. */
  refreshPolicy?: RefreshPolicy;
}

/** What reading, attaching, assessing and recomputing produced for one evidence. */
export interface IngestOutcome {
  attachments: Attachment[];
  sufficiencies: Sufficiency[];
  statuses: ControlStatus[];
  validationItems: ValidationItem[];
}

/** Result of one deposit; `duplicateOf` is set when the bytes were already known — R8. */
export interface IngestResult extends IngestOutcome {
  evidence: Evidence;
  duplicateOf: EvidenceId | null;
}

/** Human decision on one validation item, with its author and its reason — EF-VAL-02. */
export interface DecisionInput {
  decision: ValidationDecision;
  by: string;
  /** Required for `CORRECT`: what the human corrected. */
  note?: string;
}
