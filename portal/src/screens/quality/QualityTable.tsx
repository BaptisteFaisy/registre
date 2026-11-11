/* Quality table: one row per subject × metric, with its trend arrow. */

import type { QualityTableRow } from '../../lib/quality.ts';
import { VERDICT_META } from '../../lib/quality.ts';
import { DataTable } from '../../components/DataTable.tsx';
import type { Column } from '../../components/DataTable.tsx';
import { Badge } from '../../components/Primitives.tsx';
import { formatDateTime } from '../../lib/format.ts';

const COLUMNS: Array<Column<QualityTableRow>> = [
  {
    key: 'subject',
    label: 'Subject',
    width: '26%',
    render: (row) => (
      <span>
        {row.subjectLabel}
        <span className="cell-sub">prompt {row.promptVersion}</span>
      </span>
    )
  },
  {
    key: 'metric',
    label: 'Metric',
    width: '24%',
    render: (row) => <span>{row.metricLabel}</span>
  },
  { key: 'value', label: 'Value', align: 'right', render: (row) => row.valueLabel },
  { key: 'target', label: 'Target', align: 'right', render: (row) => row.targetLabel },
  {
    key: 'verdict',
    label: 'Verdict',
    render: (row) => {
      const meta = VERDICT_META[row.verdict];
      return <Badge label={meta.label} color={meta.color} />;
    }
  },
  {
    key: 'trend',
    label: 'Trend',
    align: 'right',
    render: (row) => (
      <span
        className="trend-cell"
        style={{ color: row.trendGood ? 'var(--ok)' : row.trend === 'FLAT' ? 'var(--text-dim)' : 'var(--bad)' }}
        title="Direction of the last measurement"
      >
        {row.trendSymbol}
      </span>
    )
  },
  {
    key: 'measured',
    label: 'Measured',
    align: 'right',
    render: (row) => <span className="faint small">{formatDateTime(row.measuredAt)}</span>
  }
];

/** The measured quality of every prompt version, as one table. */
export function QualityTable({
  rows,
  onSelect
}: {
  rows: readonly QualityTableRow[];
  onSelect: (key: string) => void;
}) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.key}
      onRowClick={(row) => onSelect(row.key)}
      empty="No measurement recorded yet."
    />
  );
}
