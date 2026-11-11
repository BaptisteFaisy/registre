/**
 * Pure helpers around a generated draft (axis 3b).
 * A draft is never evidence: no fingerprint, never attached — the portal only
 * shows it, counts what is left to write, and lets the owner download it.
 */

import type { Draft } from '../api/types.ts';
import { downloadText } from './download.ts';

export interface DraftProgress {
  /** Sections built from the control's expected elements. */
  total: number;
  /** Sections the owner still has to write. */
  toComplete: number;
  /** Sections carried over from the partner's previous version. */
  carried: number;
}

/** Counts the sections of a draft: nothing is computed by a model here. */
export function draftProgress(draft: Draft): DraftProgress {
  const toComplete = draft.sections.filter((section) => section.toComplete).length;
  return { total: draft.sections.length, toComplete, carried: draft.sections.length - toComplete };
}

/** One-line summary of what is left to write, e.g. "2 of 4 sections to complete". */
export function draftProgressLabel(draft: Draft): string {
  const progress = draftProgress(draft);
  return `${progress.toComplete} of ${progress.total} section(s) to complete`;
}

/** File name of the downloaded markdown. */
export function draftFileName(draft: Draft): string {
  return `registre-draft-${draft.controlId}.md`;
}

/** Triggers the browser download of the draft markdown. */
export function downloadDraft(draft: Draft): void {
  downloadText(draftFileName(draft), draft.content, 'text/markdown;charset=utf-8');
}
