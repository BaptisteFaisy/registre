/* Readiness dashboard (EF-FRA-03, EF-FRA-04, ENF-COUT-01). */

import type { Control, ControlState, ControlStatus, ReadinessOverview } from '../api/types.ts';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Stat } from '../components/Card.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { Badge, Spinner } from '../components/Primitives.tsx';
import {
  DomainBars,
  StateBar,
  StateLegend,
  TrendChart,
  TrendLabels
} from '../components/Charts.tsx';
import { PageHeader } from '../components/Page.tsx';
import { formatDate, formatPercent, formatUsd } from '../lib/format.ts';
import { STATE_ORDER, stateColor, stateLabel } from '../lib/states.ts';
import { navigate } from '../lib/router.ts';
import { StateMeaningCard } from './readiness/StateMeaningCard.tsx';
import { DriftPanel } from './readiness/DriftPanel.tsx';
import { useControlIndex, useFramework, useReadiness } from '../state/useData.ts';

export function ReadinessScreen() {
  const framework = useFramework();
  const readiness = useReadiness(framework.data?.id ?? null);
  const controls = useControlIndex(framework.data?.id ?? null);
  const overview = readiness.data;

  return (
    <div className="stack">
      <PageHeader title="Readiness" subtitle={subtitleOf(overview)} />
      {framework.error ? <ErrorState message={framework.error} onRetry={framework.reload} /> : null}
      {readiness.error ? <ErrorState message={readiness.error} onRetry={readiness.reload} /> : null}
      {framework.loading || readiness.loading ? <Spinner label="Computing readiness…" /> : null}
      {overview ? <ReadinessContent overview={overview} controls={controls} /> : null}
    </div>
  );
}

function subtitleOf(overview: ReadinessOverview | null): string {
  if (!overview) return 'Evidence states of the framework, computed by the register.';
  return (
    `${overview.framework.name} — version ${overview.framework.version}, imported ` +
    `${formatDate(overview.framework.importedAt)}. States computed on ` +
    `${formatDate(overview.snapshot.computedAt)}.`
  );
}

function ReadinessContent({
  overview,
  controls
}: {
  overview: ReadinessOverview;
  controls: Map<string, Control>;
}) {
  return (
    <>
      <StateStats overview={overview} />
      <div className="grid-2">
        <Card>
          <CardHeader
            title={`Distribution of the ${overview.snapshot.total} controls`}
            subtitle="No control is ever described as satisfactory: only its evidence is."
          />
          <CardBody>
            <StateBar counts={overview.snapshot.counts} tall />
            <StateLegend counts={overview.snapshot.counts} />
          </CardBody>
        </Card>
        <TrendCard overview={overview} />
      </div>

      <div className="grid-3">
        <Card>
          <CardHeader title="By domain" subtitle="Covered controls per domain" />
          <CardBody>
            <DomainBars byDomain={overview.byDomain} />
          </CardBody>
        </Card>
        <CostCard overview={overview} />
        <StateMeaningCard snapshot={overview.snapshot} />
      </div>

      <DriftPanel frameworkId={overview.framework.id} />

      <AttentionCard statuses={overview.statuses} controls={controls} />
    </>
  );
}

/** The list of controls that are not covered, worst state first. */
function AttentionCard({
  statuses,
  controls
}: {
  statuses: readonly ControlStatus[];
  controls: Map<string, Control>;
}) {
  return (
    <Card>
      <CardHeader
        title="Controls that need attention"
        subtitle="Everything that is not covered, worst first"
        action={
          <button type="button" className="btn btn-sm" onClick={() => navigate('/controls')}>
            All controls
          </button>
        }
      />
      <CardBody tight>
        <AttentionTable statuses={statuses} controls={controls} />
      </CardBody>
    </Card>
  );
}

/** The five headline counters, in the canonical state order. */
function StateStats({ overview }: { overview: ReadinessOverview }) {
  return (
    <div className="stat-grid">
      {STATE_ORDER.map((state) => (
        <Stat
          key={state}
          value={overview.snapshot.counts[state]}
          label={
            <>
              <span className="dot" style={{ background: stateColor(state) }} />
              {stateLabel(state)}
            </>
          }
          hint={formatPercent(overview.snapshot.shares[state], 0)}
          color={stateColor(state)}
        />
      ))}
    </div>
  );
}

function TrendCard({ overview }: { overview: ReadinessOverview }) {
  return (
    <Card>
      <CardHeader
        title="Trend over six months"
        subtitle="Snapshot of the register at the end of each month"
      />
      <CardBody>
        <TrendChart points={overview.trend} />
        <TrendLabels points={overview.trend} format={formatDate} />
      </CardBody>
    </Card>
  );
}

function CostCard({ overview }: { overview: ReadinessOverview }) {
  return (
    <Card>
      <CardHeader
        title="Cost per evidence"
        subtitle="Bedrock reading and reasoning, measured per document"
      />
      <CardBody>
        <div className="row" style={{ gap: 24 }}>
          <Stat value={formatUsd(overview.costs.perEvidenceUsd)} label="Per evidence" />
          <Stat value={formatUsd(overview.costs.totalUsd)} label="Total to date" />
          <Stat value={overview.costs.evidenceCount} label="Evidence read" />
        </div>
        <div style={{ marginTop: 12 }}>
          {Object.entries(overview.costs.bySource).map(([source, usd]) => (
            <div className="loc" key={source}>
              <span className="mono faint">{source}</span>
              <span>{formatUsd(usd)}</span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

const SEVERITY: Record<ControlState, number> = {
  NO_EVIDENCE: 0,
  EXPIRED: 1,
  TO_VERIFY: 2,
  TO_RENEW: 3,
  COVERED: 4
};

/** Table of the controls that are not covered, worst state first. */
function AttentionTable({
  statuses,
  controls
}: {
  statuses: readonly ControlStatus[];
  controls: Map<string, Control>;
}) {
  const rows = statuses
    .filter((status) => status.state !== 'COVERED')
    .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.controlId.localeCompare(b.controlId))
    .slice(0, 10);
  if (rows.length === 0) {
    return <EmptyState>Every control carries fresh, complete evidence.</EmptyState>;
  }
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.controlId}
      onRowClick={(row) => navigate(`/controls/${row.controlId}`)}
      columns={[
        {
          key: 'id',
          label: 'Control',
          width: '46%',
          render: (row) => <ControlCell id={row.controlId} control={controls.get(row.controlId)} />
        },
        {
          key: 'state',
          label: 'State',
          render: (row) => <Badge label={stateLabel(row.state)} color={stateColor(row.state)} />
        },
        {
          key: 'expires',
          label: 'Best evidence expires',
          render: (row) => <span className="faint">{formatDate(row.expiresAt)}</span>
        },
        {
          key: 'action',
          label: '',
          align: 'right',
          render: () => <span className="faint small">open →</span>
        }
      ]}
    />
  );
}

function ControlCell({ id, control }: { id: string; control: Control | undefined }) {
  return (
    <div>
      <div className="cell-title">
        <span className="mono faint">{id}</span> {control?.title ?? ''}
      </div>
      <div className="cell-sub">{control ? `${control.domain} · ${control.owner}` : '—'}</div>
    </div>
  );
}
