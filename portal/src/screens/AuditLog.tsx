/* Append-only audit trail, filterable by action (EF-ADM-02, ENF-INT-02). */

import { useMemo, useState } from 'react';
import type { AuditAction } from '../api/types.ts';
import { useApiData } from '../state/useData.ts';
import { Card, CardBody, CardHeader, ErrorState, Notice } from '../components/Card.tsx';
import { PageHeader } from '../components/Page.tsx';
import { ChainTags, LogRows, LogToolbar } from './audit/LogParts.tsx';

type ActionFilter = 'ALL' | AuditAction;

export function AuditLogScreen() {
  const [action, setAction] = useState<ActionFilter>('ALL');
  const [limit, setLimit] = useState('40');
  const log = useAuditLog(action, limit);
  const everything = useApiData((api) => api.listAuditLog({ limit: 200 }));
  const actions = useMemo(
    () => Array.from(new Set((everything.data ?? []).map((event) => event.action))).sort(),
    [everything.data]
  );
  const events = log.data ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Audit log"
        subtitle="Every collection, reading, attachment, validation and export is appended to a hash-chained journal that cannot be edited."
      />
      {log.error ? <ErrorState message={log.error} onRetry={log.reload} /> : null}
      <Card>
        <CardHeader
          title={`${events.length} event(s)`}
          subtitle="Most recent first"
          action={<ChainTags headHash={events[0]?.hash ?? null} />}
        />
        <LogToolbar
          action={action}
          limit={limit}
          actions={actions}
          onAction={setAction}
          onLimit={setLimit}
        />
        <CardBody tight>
          <LogRows events={events} loading={log.loading} />
        </CardBody>
        <footer className="card-footer">
          Each entry stores the hash of the previous one: removing or editing a line breaks the
          chain, which the export verifies before release.
        </footer>
      </Card>
      <Notice tone="info">
        Filtering by action narrows the list; the journal itself keeps every event, including refused
        access attempts.
      </Notice>
    </div>
  );
}

/** Loads one page of the journal for the selected filter. */
function useAuditLog(action: ActionFilter, limit: string) {
  return useApiData(
    (api) =>
      api.listAuditLog({ limit: Number(limit), action: action === 'ALL' ? undefined : action }),
    [action, limit]
  );
}
