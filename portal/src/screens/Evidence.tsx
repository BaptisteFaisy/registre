/* Evidence detail: fields read, flags, fingerprint, locations, masked extracts. */

import type { Evidence } from '../api/types.ts';
import { useApiData } from '../state/useData.ts';
import { ErrorState } from '../components/Card.tsx';
import { Badge, Spinner, Tag } from '../components/Primitives.tsx';
import { Crumbs, PageHeader } from '../components/Page.tsx';
import { formatDate, formatDateTime } from '../lib/format.ts';
import { ACCESS_COLOR, ACCESS_LABEL } from '../lib/states.ts';
import { navigate } from '../lib/router.ts';
import { EvidenceColumns } from './evidence/EvidenceColumns.tsx';

export function EvidenceScreen({ evidenceId }: { evidenceId: string }) {
  const state = useApiData((api) => api.getEvidence(evidenceId), [evidenceId]);
  const evidence = state.data;

  return (
    <div className="stack">
      <Crumbs
        items={[{ label: 'Evidence', onClick: () => navigate('/controls') }, { label: evidenceId }]}
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !evidence ? <Spinner label="Opening the evidence…" /> : null}
      {evidence ? <EvidenceBody evidence={evidence} /> : null}
    </div>
  );
}

function EvidenceBody({ evidence }: { evidence: Evidence }) {
  const fields = evidence.fields;
  const flags = evidence.flags;
  return (
    <>
      <PageHeader
        title={fields.title ?? evidence.id}
        subtitle={`${evidence.id} · read by ${evidence.reader} on ${formatDateTime(evidence.ingestedAt)}`}
        actions={
          <Badge
            label={ACCESS_LABEL[evidence.accessLevel]}
            color={ACCESS_COLOR[evidence.accessLevel]}
          />
        }
      />
      <div className="detail-head" style={{ marginBottom: 16 }}>
        <Tag>{fields.type ?? 'unknown type'}</Tag>
        <Tag>Document date {formatDate(fields.documentDate)}</Tag>
        <Tag>Revision {evidence.revision}</Tag>
        {fields.personalData ? <Tag>Personal data — extracts masked</Tag> : null}
        {flags.unreadable ? <Badge label="Unreadable" color="var(--bad)" /> : null}
        {flags.dateToConfirm ? <Badge label="Date to confirm" color="var(--warn)" /> : null}
        {!fields.approver ? <Badge label="Not signed" color="var(--alert)" /> : null}
      </div>
      <EvidenceColumns evidence={evidence} />
    </>
  );
}
