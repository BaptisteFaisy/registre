/**
 * Optional quote verification for the question-answering measure.
 *
 * The scorer normally works on the ids a run cites. When the text of the
 * evidence files is available (the demo writes them), the cited passage is
 * checked inside the document as well — the same code path the pipeline uses
 * at run time (`src/domain/citation.ts`), so the measure and the product
 * cannot drift apart.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyQuoteInPages } from '../../../src/domain/citation.ts';
import type { TextPage } from '../../../src/domain/types.ts';
import { EVIDENCE } from '../../../eval/catalogue.ts';

/** Text of the evidence files, indexed by evidence id. */
export type EvidenceTexts = Map<string, TextPage[]>;

const TEXT_SUFFIXES = ['.pdf', '.txt', '.md', '.csv', '.html', '.json'];

/** True when the bytes look like readable text rather than a binary blob. */
function isTextual(buffer: Buffer): boolean {
  if (buffer.byteLength > 2_000_000) return false;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, 4096).toString('utf8');
  const printable = sample.split('').filter((char) => char === '\n' || char === '\t' || (char >= ' ' && char <= 'ÿ')).length;
  return sample.length === 0 || printable / sample.length > 0.9;
}

/** Reads every evidence file of `dir` that holds readable text. */
export function loadEvidenceTexts(dir: string): EvidenceTexts {
  const texts: EvidenceTexts = new Map();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return texts;
  }
  const known = new Set(EVIDENCE.map((item) => item.fileName));
  for (const name of entries) {
    if (!known.has(name)) continue;
    if (!TEXT_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) continue;
    const buffer = readFileSync(join(dir, name));
    if (!isTextual(buffer)) continue;
    const item = EVIDENCE.find((candidate) => candidate.fileName === name);
    if (item === undefined) continue;
    texts.set(item.id, [{ page: 1, text: buffer.toString('utf8') }]);
  }
  return texts;
}

/** True when the quote is found in the document; true when the text is unknown. */
export function quoteSupported(texts: EvidenceTexts | null, evidenceId: string, quote: string | undefined): boolean {
  if (texts === null) return true;
  const pages = texts.get(evidenceId);
  if (pages === undefined) return true;
  if (quote === undefined || quote.trim().length === 0) return false;
  return verifyQuoteInPages(pages, quote).found;
}
