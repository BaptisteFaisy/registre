/**
 * Human sentences for the machine-readable notes attached to a control state.
 * Keeping them here avoids duplicating wording across screens.
 */

export const NOTE_LABEL: Record<string, string> = {
  'no-applied-evidence': 'No evidence is applied to this control.',
  'only-proposed-attachments': 'Only proposed attachments exist: a human must validate them.',
  'every-applied-evidence-expired': 'Every applied evidence is older than the control periodicity.',
  'best-evidence-expires-soon': 'The best evidence expires within the renewal lead time.',
  'partial-sufficiency': 'One or more expected elements are missing from the attached evidence.',
  'low-confidence-sufficiency': 'The reading confidence is too low to trust the assessment.',
  'pending-proposals': 'Attachments are waiting in the validation queue.',
  'evidence-unreadable': 'The document could not be read reliably.',
  'document-date-missing': 'The document carries no readable date.',
  'document-date-to-confirm': 'The document date differs from the file date and must be confirmed.',
  'document-not-signed': 'The document carries no approver signature.',
  'duplicate-location': 'The same content is stored twice under two names.',
  'evidence-missing': 'The retained evidence is no longer in the vault.'
};

/** Reads a note code, falling back to the raw code for unknown values. */
export function noteLabel(code: string): string {
  return NOTE_LABEL[code] ?? code;
}
