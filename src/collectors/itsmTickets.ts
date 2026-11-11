/**
 * Ticket parsing and serialisation for the ITSM collector (EF-COL-03).
 *
 * The source exports are JSON or CSV; both are normalised into `TicketRecord`
 * and written back out in the format the audit pack expects. Everything here is
 * pure: no I/O, so the collector tests need no fixture file on disk.
 */

import { badRequest } from '../support/errors.ts';

/** One incident, change or problem, normalised across ITSM vendors. */
export interface TicketRecord {
  id: string;
  /** `INCIDENT`, `CHANGE`, `PROBLEM`, or whatever the export calls it. */
  kind: string;
  createdAt: string;
  closedAt: string | null;
  status: string;
  priority: string;
  title: string;
}

/** Column order of the generated CSV, also used as the header line. */
export const TICKET_COLUMNS = [
  'id',
  'kind',
  'createdAt',
  'closedAt',
  'status',
  'priority',
  'title'
] as const;

/** Candidate source keys for each normalised field, in priority order. */
const FIELD_ALIASES: Record<keyof TicketRecord, readonly string[]> = {
  id: ['id', 'number', 'key', 'ticketId', 'ticket_id'],
  kind: ['kind', 'type', 'category', 'recordType', 'record_type'],
  createdAt: ['createdAt', 'created_at', 'openedAt', 'opened_at', 'date'],
  closedAt: ['closedAt', 'closed_at', 'resolvedAt', 'resolved_at', 'endDate'],
  status: ['status', 'state'],
  priority: ['priority', 'severity', 'urgency'],
  title: ['title', 'shortDescription', 'short_description', 'summary', 'subject']
};

/** Parses an export, detecting JSON or CSV, and normalises every row. */
export function parseTickets(raw: string): TicketRecord[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  return text.startsWith('[') || text.startsWith('{') ? fromJson(text) : fromCsv(text);
}

/** Tickets whose lifetime overlaps `[since, until]` (either bound optional). */
export function filterTickets(
  tickets: readonly TicketRecord[],
  since?: string,
  until?: string
): TicketRecord[] {
  return tickets.filter((ticket) => {
    const start = ticket.createdAt;
    const end = ticket.closedAt ?? ticket.createdAt;
    if (until !== undefined && start > until) return false;
    if (since !== undefined && end < since) return false;
    return true;
  });
}

/** Counts per kind, for the summary line of the generated file. */
export function countByKind(tickets: readonly TicketRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ticket of tickets) counts[ticket.kind] = (counts[ticket.kind] ?? 0) + 1;
  return counts;
}

/** Serialises tickets as CSV, quoting anything that needs it. */
export function ticketsToCsv(tickets: readonly TicketRecord[]): string {
  const lines = [TICKET_COLUMNS.join(',')];
  for (const ticket of tickets) {
    lines.push(TICKET_COLUMNS.map((column) => csvCell(ticket[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Serialises tickets as a JSON document with a stable key order. */
export function ticketsToJson(tickets: readonly TicketRecord[], generatedAt: string | null = null): string {
  return `${JSON.stringify(
    { generatedAt, count: tickets.length, byKind: countByKind(tickets), tickets },
    null,
    2
  )}\n`;
}

/* --------------------------------------------------------------- private */

function fromJson(text: string): TicketRecord[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed) ? parsed : arrayProperty(parsed);
  if (rows === null) throw badRequest('itsm export: no ticket array found in the JSON document');
  return rows.map((row) => toTicket(asRecord(row)));
}

/** Finds the array holding the tickets in a wrapper object. */
function arrayProperty(value: unknown): unknown[] | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['tickets', 'items', 'data', 'records', 'results']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function fromCsv(text: string): TicketRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0];
  if (header === undefined) return [];
  const columns = splitCsvLine(header).map((name) => name.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? '';
    });
    return toTicket(row);
  });
}

/** Splits one CSV line, honouring double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toTicket(row: Record<string, unknown>): TicketRecord {
  return {
    id: firstString(row, FIELD_ALIASES.id),
    kind: firstString(row, FIELD_ALIASES.kind).toUpperCase() || 'INCIDENT',
    createdAt: firstString(row, FIELD_ALIASES.createdAt),
    closedAt: firstString(row, FIELD_ALIASES.closedAt) || null,
    status: firstString(row, FIELD_ALIASES.status),
    priority: firstString(row, FIELD_ALIASES.priority),
    title: firstString(row, FIELD_ALIASES.title)
  };
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function csvCell(value: string | null): string {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
