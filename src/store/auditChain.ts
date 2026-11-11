/**
 * Hash chain shared by every `AuditSink` implementation (ENF-INT-02).
 *
 * "The action log cannot be modified." Each event carries the fingerprint of
 * the previous one, so rewriting, reordering or deleting an event breaks the
 * chain and `verifyEvents` reports the first broken sequence number.
 *
 * One implementation, reused by the in-memory sink and the DynamoDB sink.
 */

import type { AuditAction, AuditEvent } from '../domain/types.ts';
import { sha256Json } from '../support/hash.ts';
import { newUid } from '../support/ids.ts';

/** `prevHash` of the first event of a chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** Fields a caller provides; `seq`, `prevHash` and `hash` are derived. */
export interface AuditEventInput {
  seq: number;
  at: string;
  actor: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail?: Record<string, unknown>;
}

/** An event without its own fingerprint: exactly what gets hashed. */
export type UnsignedEvent = Omit<AuditEvent, 'hash'>;

/**
 * Fingerprint of one event, over every field except `hash` (ENF-INT-02).
 * Canonical JSON keeps the digest stable whatever the key insertion order.
 */
export function eventDigest(event: UnsignedEvent): string {
  return sha256Json({
    seq: event.seq,
    id: event.id,
    at: event.at,
    actor: event.actor,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId,
    detail: event.detail,
    prevHash: event.prevHash
  });
}

/** Builds a sealed event chained onto `prevHash` (ENF-INT-02). */
export function sealEvent(input: AuditEventInput, prevHash: string): AuditEvent {
  const unsigned: UnsignedEvent = {
    seq: input.seq,
    id: newUid('ae'),
    at: input.at,
    actor: input.actor,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    detail: input.detail ?? {},
    prevHash
  };
  return { ...unsigned, hash: eventDigest(unsigned) };
}

export interface ChainVerification {
  ok: boolean;
  /** `seq` of the first event that breaks the chain, `null` when intact. */
  brokenAt: number | null;
}

/**
 * Verifies the whole chain: sequence numbers must be monotonic from 1, each
 * `prevHash` must match the previous `hash`, and each `hash` must match the
 * event content. Any rewrite, reorder, insertion or deletion is detected.
 */
export function verifyEvents(events: readonly AuditEvent[]): ChainVerification {
  let previous = GENESIS_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.seq !== index + 1) return { ok: false, brokenAt: event.seq };
    if (event.prevHash !== previous) return { ok: false, brokenAt: event.seq };
    if (eventDigest(event) !== event.hash) return { ok: false, brokenAt: event.seq };
    previous = event.hash;
  }
  return { ok: true, brokenAt: null };
}
