/**
 * Draft evidence — the missing document, pre-filled for its owner.
 *
 * Scope guard, stated here because it is the one place where the tool could be
 * accused of manufacturing compliance:
 *
 *   - a draft is **not** an evidence. It has no fingerprint, it is not stored in
 *     the vault, it never appears in a pack, and it is never attached;
 *   - it is built from the control's expected elements and from the partner's
 *     own previous version (retrieved from their knowledge base), never from
 *     another partner's data and never from a protected framework text;
 *   - every line the owner must complete is left as an explicit placeholder, and
 *     the content is watermarked;
 *   - it becomes evidence only when a human completes it, signs it and deposits
 *     it through the normal ingest path, which fingerprints and reads it like
 *     any other document.
 */

import type { ControlId, EvidenceId, FrameworkId } from './types.ts';

/** A draft is always a draft: there is no other status on purpose. */
export type DraftStatus = 'DRAFT';

/** Watermark printed at the top of every generated draft. */
export const DRAFT_WATERMARK = 'DRAFT — not evidence until signed and deposited';

export interface DraftSection {
  /** The expected element this section is meant to satisfy. */
  expected: string;
  /** Text carried over from the previous version, or an empty placeholder. */
  body: string;
  /** True when the owner still has to write this part. */
  toComplete: boolean;
}

/** One generated draft, returned to the caller and never persisted as evidence. */
export interface Draft {
  id: string;
  controlId: ControlId;
  frameworkId: FrameworkId;
  createdAt: string;
  format: 'MARKDOWN';
  title: string;
  watermark: string;
  status: DraftStatus;
  sections: DraftSection[];
  /** Evidence the draft was built from (the partner's previous version). */
  basedOn: EvidenceId[];
  /** Expected elements with nothing to carry over. */
  missing: string[];
  /** The whole document, ready to download. */
  content: string;
  /** Never true: a draft cannot be attached. Kept explicit for reviewers. */
  attachable: false;
}

/** Deterministic draft id: one draft per control per generation instant. */
export function draftId(controlId: ControlId, createdAt: string): string {
  return `df-${controlId}-${createdAt.replace(/[:.]/g, '-')}`;
}

/** Renders the sections into the markdown document a reviewer receives. */
export function renderDraft(input: {
  title: string;
  watermark: string;
  requirement: string;
  sections: DraftSection[];
  basedOn: EvidenceId[];
}): string {
  const lines = [
    `<!-- ${input.watermark} -->`,
    `# ${input.title}`,
    '',
    `> ${input.watermark}`,
    '',
    '## Requirement this document must satisfy',
    '',
    input.requirement,
    ''
  ];
  for (const section of input.sections) {
    lines.push(`## ${section.expected}`, '');
    lines.push(section.toComplete ? `_To complete: ${section.expected}._` : section.body);
    lines.push('');
  }
  if (input.basedOn.length > 0) {
    lines.push('## Carried over from', '');
    for (const id of input.basedOn) lines.push(`- ${id}`);
    lines.push('');
  }
  lines.push('## Signature', '', 'Name: ____  Role: ____  Date: ____', '');
  return lines.join('\n');
}
