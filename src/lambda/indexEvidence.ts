/**
 * `indexEvidence` handler — the last task of the chain (spec 11.3, EF-RAT-01).
 *
 * CHOICE, stated plainly: a managed Bedrock knowledge base is fed by its S3
 * data source, not by an API call from the application. There is no
 * "index this document now" call to make, so this adapter does the only honest
 * thing available to it:
 *
 *  - when `REGISTRE_KB_SOURCE_PREFIX` is configured, it deposits a copy of the
 *    document under that prefix and reports the deposit (`deposited: true`);
 *  - when it is not configured, it reports `indexed: false` with the reason;
 *  - `indexed` is never `true` from here. The crawl belongs to the data source,
 *    on its own schedule: claiming an index we did not perform would be a fake
 *    success, and a registry of audit evidence cannot afford one.
 */

import { safeName } from '../collectors/index.ts';
import { bytesOf, defineHandler, lambdaServices, optionalString } from './shared.ts';

/** Why nothing was indexed when the deployment has no knowledge-base source. */
export const NOT_CONFIGURED_REASON = 'knowledge-base ingestion is driven by the data source';

/** Why nothing was deposited: the crawl cannot invent the bytes either. */
const NO_BYTES_REASON = 'no document bytes in the event: nothing to deposit under the source prefix';

/** What a deposit means, without pretending the crawl already happened. */
const DEPOSITED_REASON =
  'copy deposited under the knowledge-base source prefix; the data source crawls it on its own schedule';

/** Env var holding the prefix the knowledge-base data source watches. */
export const KB_SOURCE_PREFIX_ENV = 'REGISTRE_KB_SOURCE_PREFIX';

/** Object key of the copy: `<prefix>/<evidence id>.<extension>`. */
function keyOf(prefix: string, raw: Record<string, unknown>, contentType: string): string {
  const id = optionalString(raw, 'evidenceId') ?? optionalString(raw, 'sha256') ?? 'document';
  const extension = contentType.split('/')[1]?.split(';')[0]?.trim() ?? 'bin';
  return `${prefix.replace(/\/+$/, '')}/${safeName(id)}.${safeName(extension)}`;
}

/** One report of this step: never a success it cannot vouch for. */
function report(fields: Record<string, unknown>, raw: Record<string, unknown>) {
  return { output: { indexed: false, ...fields }, payload: { ...raw, indexed: false, ...fields } };
}

export const handler = defineHandler(async (raw) => {
  const prefix = (process.env[KB_SOURCE_PREFIX_ENV] ?? '').trim();
  if (prefix.length === 0) return report({ reason: NOT_CONFIGURED_REASON }, raw);

  const bytes = bytesOf(raw);
  if (bytes === null) return report({ reason: NO_BYTES_REASON }, raw);

  const services = await lambdaServices();
  const contentType = optionalString(raw, 'contentType') ?? 'application/octet-stream';
  const stored = await services.evidenceStore.put({ key: keyOf(prefix, raw, contentType), bytes, contentType });
  return report({ deposited: true, sourceUri: stored.uri, reason: DEPOSITED_REASON }, raw);
});
