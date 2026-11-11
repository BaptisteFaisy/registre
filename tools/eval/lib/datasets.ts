/**
 * Loads the four generated datasets from disk and validates every row, so the
 * scorer never measures against a hand-edited or truncated file.
 */

import { join } from 'node:path';
import { DATASET_FILES, validateDataset } from './schema.ts';
import type { AttachmentRow, DatasetName, QaRow, ReadingRow, SufficiencyRow } from './schema.ts';
import { readJsonlFile } from './jsonl.ts';

export interface LoadedDatasets {
  reading: ReadingRow[];
  attachment: AttachmentRow[];
  sufficiency: SufficiencyRow[];
  qa: QaRow[];
}

function loadOne(name: DatasetName, dir: string): unknown[] {
  const path = join(dir, DATASET_FILES[name]);
  const rows = readJsonlFile(path);
  const problems = validateDataset(name, rows);
  if (problems.length > 0) {
    throw new Error(`${path}: ${problems.length} invalid row(s): ${problems.slice(0, 5).join('; ')}`);
  }
  return rows;
}

/** Reads and validates `reading.jsonl`, `attachment.jsonl`, `sufficiency.jsonl`, `qa.jsonl`. */
export function loadDatasets(dir: string): LoadedDatasets {
  return {
    reading: loadOne('reading', dir) as ReadingRow[],
    attachment: loadOne('attachment', dir) as AttachmentRow[],
    sufficiency: loadOne('sufficiency', dir) as SufficiencyRow[],
    qa: loadOne('qa', dir) as QaRow[]
  };
}
