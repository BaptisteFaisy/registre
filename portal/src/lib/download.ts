/**
 * Client-side download of the readable pack index (EF-DOS-02).
 *
 * In production the archive comes from the API; the portal also lets a reader
 * save the plain-text index, which is what an auditor opens first.
 */

import type { Pack } from '../api/types.ts';
import { stateLabel } from './states.ts';

/** Renders the pack index as plain text, one block per control. */
export function packIndexText(pack: Pack): string {
  const lines: string[] = [
    `Registre — audit pack ${pack.id}`,
    `Framework: ${pack.frameworkId}`,
    `Frozen at: ${pack.frozenAt}`,
    `Archive: ${pack.archive.uri}`,
    `Archive SHA-256: ${pack.archive.sha256}`,
    `Checksums verified: ${pack.checksumsVerified ? 'yes' : 'no'}`,
    '',
    'Known gaps',
    '-----------'
  ];
  for (const gap of pack.knownGaps) {
    lines.push(`- ${gap.controlId} [${stateLabel(gap.state)}] ${gap.detail}`);
  }
  lines.push('', 'Index by control', '----------------');
  for (const entry of pack.index) {
    lines.push(`${entry.controlId} — ${entry.controlTitle} [${stateLabel(entry.state)}]`);
    for (const evidence of entry.evidence) {
      lines.push(
        `  · ${evidence.evidenceId} ${evidence.title ?? ''} (${evidence.documentDate ?? 'no date'}) ` +
          `sha256:${evidence.sha256.slice(0, 16)} page ${evidence.page ?? '—'}`
      );
      lines.push(`    "${evidence.quote}"`);
    }
  }
  return lines.join('\n');
}

/** Triggers the browser download of the index text. */
export function downloadPackIndex(pack: Pack): void {
  const blob = new Blob([packIndexText(pack)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `registre-pack-${pack.id}-index.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
