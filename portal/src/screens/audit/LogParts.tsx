/* Pieces of the audit log screen: chain tags, filter toolbar and rows. */

import type { AuditAction, AuditEvent } from '../../api/types.ts';
import { EmptyState } from '../../components/Card.tsx';
import { Field, Select } from '../../components/Form.tsx';
import { Spinner, Tag } from '../../components/Primitives.tsx';
import { formatDateTime, shortHash } from '../../lib/format.ts';

export type ActionFilter = 'ALL' | AuditAction;

export function ChainTags({ headHash }: { headHash: string | null }) {
  return (
    <div className="row">
      <Tag>chain verified</Tag>
      <Tag>{headHash ? `head ${shortHash(headHash)}` : 'empty'}</Tag>
    </div>
  );
}

export function LogToolbar({
  action,
  limit,
  actions,
  onAction,
  onLimit
}: {
  action: ActionFilter;
  limit: string;
  actions: readonly string[];
  onAction: (value: ActionFilter) => void;
  onLimit: (value: string) => void;
}) {
  return (
    <div className="toolbar">
      <Field label="Action">
        <Select<ActionFilter>
          ariaLabel="Filter by action"
          value={action}
          onChange={onAction}
          options={[
            { value: 'ALL', label: 'All actions' },
            ...actions.map((item) => ({ value: item as ActionFilter, label: item }))
          ]}
        />
      </Field>
      <Field label="Events">
        <Select
          ariaLabel="Number of events"
          value={limit}
          onChange={onLimit}
          options={[
            { value: '20', label: '20' },
            { value: '40', label: '40' },
            { value: '100', label: '100' }
          ]}
        />
      </Field>
    </div>
  );
}

export function LogRows({ events, loading }: { events: readonly AuditEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <Spinner label="Reading the journal…" />
      </div>
    );
  }
  if (events.length === 0) return <EmptyState>No event for this filter.</EmptyState>;
  return (
    <div style={{ padding: '4px 16px 12px' }}>
      {events.map((event) => (
        <div className="log-row" key={event.id}>
          <span className="faint mono">{formatDateTime(event.at)}</span>
          <span className="log-action">{event.action}</span>
          <span className="log-object">
            {event.actor} · {event.objectType} <span className="mono">{event.objectId}</span>
            <span className="log-detail"> {JSON.stringify(event.detail)}</span>
          </span>
          <span className="faint mono" title={`previous ${event.prevHash}`}>
            #{event.seq} {shortHash(event.hash)}
          </span>
        </div>
      ))}
    </div>
  );
}
