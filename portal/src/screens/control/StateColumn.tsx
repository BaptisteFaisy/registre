/* Right column of a control detail: computed state and the evidence in the vault. */

import type { ControlWithRelations, Principal } from '../../api/types.ts';
import { Card, CardBody, CardHeader, KeyValue } from '../../components/Card.tsx';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { formatDate, shortHash } from '../../lib/format.ts';
import {
  FRESHNESS_LABEL,
  stateColor,
  stateLabel,
  sufficiencyColor,
  sufficiencyLabel
} from '../../lib/states.ts';
import { noteLabel } from '../../lib/notes.ts';
import { hasHiddenEvidence, restrictedNotice } from '../../lib/access.ts';
import { navigate } from '../../lib/router.ts';
import { usePrincipal } from '../../state/app.tsx';

export function StateColumn({ data }: { data: ControlWithRelations }) {
  const principal = usePrincipal();
  return (
    <div className="stack">
      <StateCard data={data} />
      <VaultCard data={data} notice={vaultNotice(principal, data)} />
    </div>
  );
}

/** Footer of the vault card: only explains the filter when it actually bites. */
function vaultNotice(principal: Principal, data: ControlWithRelations): string | null {
  const hidden = hasHiddenEvidence(principal, data.evidence.map((item) => item.accessLevel));
  if (!hidden) return null;
  return restrictedNotice(principal);
}

function StateCard({ data }: { data: ControlWithRelations }) {
  const { control, status } = data;
  return (
    <Card>
      <CardHeader title="Computed state" subtitle={`Computed on ${formatDate(status.computedAt)}`} />
      <CardBody>
        <KeyValue
          items={[
            {
              label: 'State',
              value: <Badge label={stateLabel(status.state)} color={stateColor(status.state)} />
            },
            { label: 'Freshness', value: FRESHNESS_LABEL[status.freshness] },
            {
              label: 'Sufficiency',
              value: status.sufficiencyClass ? (
                <Badge
                  label={sufficiencyLabel(status.sufficiencyClass)}
                  color={sufficiencyColor(status.sufficiencyClass)}
                  soft
                  dot={false}
                />
              ) : (
                '—'
              )
            },
            { label: 'Best evidence expires', value: formatDate(status.expiresAt) },
            { label: 'Best evidence', value: bestEvidenceLink(status.bestEvidenceId) },
            { label: 'Awaiting review', value: `${status.pendingProposals} attachment(s)` },
            { label: 'Owner', value: control.owner }
          ]}
        />
      </CardBody>
      <StateNotes notes={status.notes} />
    </Card>
  );
}

function VaultCard({ data, notice }: { data: ControlWithRelations; notice: string | null }) {
  return (
    <Card>
      <CardHeader
        title="Evidence in the vault"
        subtitle="Restricted documents follow the clearance of the role"
      />
      <CardBody tight>
        {data.evidence.map((evidence) => (
          <div className="loc" key={evidence.id} style={{ padding: '8px 16px' }}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => navigate(`/evidence/${evidence.id}`)}
              >
                {evidence.fields.title ?? evidence.id}
              </button>
              <span className="cell-sub">
                {formatDate(evidence.fields.documentDate)} · {shortHash(evidence.sha256)}
              </span>
            </span>
            <Tag>{evidence.accessLevel}</Tag>
          </div>
        ))}
      </CardBody>
      {notice ? <footer className="card-footer">{notice}</footer> : null}
    </Card>
  );
}

function bestEvidenceLink(evidenceId: string | null) {
  if (!evidenceId) return '—';
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={() => navigate(`/evidence/${evidenceId}`)}
    >
      {evidenceId}
    </button>
  );
}

/** Notes of the state engine, turned into sentences. */
function StateNotes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) {
    return <footer className="card-footer">No caveat: the evidence is fresh and complete.</footer>;
  }
  return (
    <footer className="card-footer">
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {notes.map((note) => (
          <li key={note}>{noteLabel(note)}</li>
        ))}
      </ul>
    </footer>
  );
}
