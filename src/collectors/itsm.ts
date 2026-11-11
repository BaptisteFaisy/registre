/**
 * ITSM collector — EF-COL-03: "collect ticket exports: incidents, changes,
 * problems, over a period".
 *
 * The source is either a local file (an export dropped by the ITSM scheduler)
 * or an HTTP endpoint (the ITSM API or a signed URL). Both are behind
 * `TextSource`, so tests inject a string and never open a socket.
 *
 * Output: one dated file per run (`itsm/<system>/<YYYY-MM-DD>.csv`), which is
 * what an auditor expects to find in the pack — a period, a count per kind, and
 * the tickets themselves.
 */

import { addDays } from '../support/iso8601.ts';
import { readFile } from 'node:fs/promises';
import { upstream } from '../support/errors.ts';
import type { Clock } from '../ports/index.ts';
import type { CollectedFile, Collector, CollectorCursor } from './types.ts';
import { collectedFile, dayOf, safeName, utf8Bytes } from './types.ts';
import { filterTickets, parseTickets, ticketsToCsv, ticketsToJson } from './itsmTickets.ts';

/** A text document to collect: a file on disk or an HTTP endpoint. */
export interface TextSource {
  /** Human description, journalled with the evidence. */
  readonly description: string;
  read(): Promise<string>;
}

/** Injected HTTP reader, so the collector never hard-codes `fetch`. */
export type TextFetcher = (url: string) => Promise<string>;

/** Reads an export from the local file system. */
export function fileTextSource(path: string): TextSource {
  return {
    description: `file://${path}`,
    async read() {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        throw upstream('itsm: reading the export file failed', {
          path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}

/** Reads an export over HTTP; the fetcher is injectable for tests. */
export function httpTextSource(url: string, fetcher?: TextFetcher): TextSource {
  return {
    description: url,
    async read() {
      const read = fetcher ?? defaultFetcher;
      try {
        return await read(url);
      } catch (error) {
        throw upstream('itsm: reading the export endpoint failed', {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}

/** Default HTTP reader: the platform `fetch`, only reached in production. */
const defaultFetcher: TextFetcher = async (url) => {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw upstream(`itsm: endpoint answered ${response.status}`, { url });
  return response.text();
};

export interface ItsmCollectorOptions {
  source: TextSource;
  clock: Clock;
  id?: string;
  /** Ticket family, used in the file name: `incidents`, `changes`, `problems`. */
  system?: string;
  /** Generated format; CSV by default, JSON on request (EF-COL-03). */
  format?: 'CSV' | 'JSON';
  /** Window used when the cursor carries none; defaults to the last 90 days. */
  since?: string;
  until?: string;
}

export class ItsmCollector implements Collector {
  readonly id: string;
  readonly kind = 'ITSM' as const;

  private readonly options: ItsmCollectorOptions;

  /** Builds a ticket collector over an injected text source. */
  constructor(options: ItsmCollectorOptions) {
    this.options = options;
    this.id = options.id ?? `collector-itsm-${safeName(options.system ?? 'tickets')}`;
  }

  /** Reads the export, keeps the period, and produces one dated file. */
  async collect(cursor?: CollectorCursor): Promise<CollectedFile[]> {
    const text = await this.options.source.read();
    const tickets = parseTickets(text);
    const until = cursor?.until ?? this.options.until ?? this.options.clock.now();
    const since = cursor?.since ?? this.options.since ?? addDays(until, -90);
    const selected = filterTickets(tickets, since, until);
    const format = this.options.format ?? 'CSV';
    const system = safeName(this.options.system ?? 'tickets');
    const day = dayOf(until);
    const extension = format === 'JSON' ? 'json' : 'csv';
    const body =
      format === 'JSON' ? ticketsToJson(selected, until) : ticketsToCsv(selected);
    return [
      collectedFile({
        key: `itsm/${system}/${day}.${extension}`,
        uri: `${this.options.source.description}#${day}`,
        kind: 'ITSM',
        contentType: format === 'JSON' ? 'application/json' : 'text/csv',
        bytes: utf8Bytes(body),
        collectedAt: this.options.clock.now(),
        title: `${system} ${since.slice(0, 10)} to ${day}`,
        fileDate: day,
        metadata: {
          system,
          format,
          since,
          until,
          ticketCount: String(selected.length)
        }
      })
    ];
  }
}
