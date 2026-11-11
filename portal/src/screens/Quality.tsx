/* Measured quality: the system grades itself, per subject and prompt version. */

import { useMemo, useState } from 'react';
import { Card, CardBody, CardHeader, ErrorState, Notice, Stat } from '../components/Card.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { useApiData } from '../state/useData.ts';
import { qualityRows, thresholdNotice } from '../lib/quality.ts';
import { QualityTable } from './quality/QualityTable.tsx';
import { TrendSvg } from './quality/TrendSvg.tsx';

export function QualityScreen() {
  const state = useApiData((api) => api.getQuality());
  const report = state.data;
  const rows = useMemo(() => (report ? qualityRows(report) : []), [report]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Default selection: the failing metric — the one that proves the argument.
  const selected =
    rows.find((row) => row.key === selectedKey) ?? rows.find((row) => row.verdict === 'FAIL') ?? rows[0] ?? null;

  return (
    <div className="stack">
      <PageHeader
        title="Measured quality"
        subtitle="Every attachment and answer is produced by a model at a given prompt version. Evaluation jobs grade those versions; the register publishes the verdicts — including the bad ones."
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !report ? <Spinner label="Loading the measurements…" /> : null}
      {report ? (
        <>
          <ThresholdCard threshold={report.thresholdInEffect} notice={thresholdNotice(report)} />
          <Card>
            <CardHeader
              title="Measurements by subject and prompt version"
              subtitle="Click a row to draw its trend. A value under its target is never hidden: it flips the pipeline to all-human."
            />
            <CardBody tight>
              <QualityTable rows={rows} onSelect={setSelectedKey} />
            </CardBody>
          </Card>
          {selected ? (
            <Card>
              <CardHeader
                title={`Trend — ${selected.metricLabel}`}
                subtitle={selected.subjectLabel}
              />
              <CardBody>
                <TrendSvg row={selected} />
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The strong argument, made unreadable-proof: one number, one sentence. */
function ThresholdCard({ threshold, notice }: { threshold: number; notice: string }) {
  const degraded = threshold > 1;
  return (
    <Card>
      <CardHeader
        title="Confidence threshold in effect"
        subtitle="What the pipeline actually applies right now"
      />
      <CardBody>
        <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
          <Stat
            value={threshold.toFixed(2)}
            label={degraded ? 'Above every possible confidence' : 'Configured threshold'}
            color={degraded ? 'var(--bad)' : 'var(--ok)'}
            hint={degraded ? 'Auto-application is OFF' : 'Auto-application is ON above it'}
          />
          <div style={{ maxWidth: 720 }}>
            <Notice tone={degraded ? 'warn' : 'info'}>{notice}</Notice>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
