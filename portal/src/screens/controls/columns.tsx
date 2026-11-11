/* Column definitions of the controls table, kept out of the screen. */

import type { Control, ControlState, ControlStatus } from '../../api/types.ts';
import type { Column } from '../../components/DataTable.tsx';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { formatDate, formatPeriodicity } from '../../lib/format.ts';
import { stateColor, stateLabel, sufficiencyColor, sufficiencyLabel } from '../../lib/states.ts';

/** Columns of the filterable control list (EF-FRA-03). */
export function controlColumns(
  statusById: Map<string, ControlStatus>
): Array<Column<Control>> {
  const stateOf = (id: string): ControlState | undefined => statusById.get(id)?.state;
  return [
    { key: 'control', label: 'Control', width: '34%', render: (row) => <ControlCell control={row} /> },
    { key: 'domain', label: 'Domain', render: (row) => <Tag>{row.domain}</Tag> },
    { key: 'owner', label: 'Owner', render: (row) => <span className="muted">{row.owner}</span> },
    { key: 'state', label: 'State', render: (row) => <StateCell state={stateOf(row.id)} /> },
    {
      key: 'sufficiency',
      label: 'Sufficiency',
      render: (row) => <SufficiencyCell status={statusById.get(row.id)} />
    },
    {
      key: 'expires',
      label: 'Expires',
      render: (row) => (
        <span className="faint">{formatDate(statusById.get(row.id)?.expiresAt ?? null)}</span>
      )
    },
    {
      key: 'proposals',
      label: 'To review',
      align: 'right',
      render: (row) => <ProposalsCell pending={statusById.get(row.id)?.pendingProposals ?? 0} />
    }
  ];
}

function ControlCell({ control }: { control: Control }) {
  return (
    <div>
      <div className="cell-title">
        <span className="mono faint">{control.id}</span> {control.title}
        {control.mandatory ? <span title="Mandatory control"> •</span> : null}
      </div>
      <div className="cell-sub">{formatPeriodicity(control.periodicity)}</div>
    </div>
  );
}

function StateCell({ state }: { state: ControlState | undefined }) {
  if (!state) return <span className="faint">—</span>;
  return <Badge label={stateLabel(state)} color={stateColor(state)} />;
}

function SufficiencyCell({ status }: { status: ControlStatus | undefined }) {
  if (!status?.sufficiencyClass) return <span className="faint">—</span>;
  return (
    <Badge
      label={sufficiencyLabel(status.sufficiencyClass)}
      color={sufficiencyColor(status.sufficiencyClass)}
      soft
      dot={false}
    />
  );
}

function ProposalsCell({ pending }: { pending: number }) {
  if (pending === 0) return <span className="faint">0</span>;
  return <span className="warn-text">{pending}</span>;
}
