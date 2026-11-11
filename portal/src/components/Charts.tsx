/* State distribution and readiness trend, drawn with plain CSS and SVG. */

import type { ControlState, ReadinessTrendPoint } from '../api/types.ts';
import { STATE_ORDER, stateColor, stateLabel } from '../lib/states.ts';
import { formatPercent } from '../lib/format.ts';

export type StateCounts = Record<ControlState, number>;

function totalOf(counts: StateCounts): number {
  return STATE_ORDER.reduce((sum, state) => sum + counts[state], 0);
}

/** Stacked bar showing the share of each control state. */
export function StateBar({ counts, tall = false }: { counts: StateCounts; tall?: boolean }) {
  const total = totalOf(counts);
  return (
    <div className={tall ? 'bar bar-tall' : 'bar'} role="img" aria-label="Control state distribution">
      {STATE_ORDER.map((state) => {
        const share = total === 0 ? 0 : (counts[state] / total) * 100;
        if (share === 0) return null;
        return (
          <span
            key={state}
            className="bar-seg"
            style={{ width: `${share}%`, background: stateColor(state) }}
            title={`${stateLabel(state)}: ${counts[state]} (${formatPercent(share / 100)})`}
          />
        );
      })}
    </div>
  );
}

/** Legend with counts and shares, in the canonical state order. */
export function StateLegend({ counts }: { counts: StateCounts }) {
  const total = totalOf(counts);
  return (
    <div className="legend">
      {STATE_ORDER.map((state) => (
        <span key={state} className="legend-item">
          <span className="dot" style={{ background: stateColor(state) }} />
          {stateLabel(state)}
          <span className="legend-value">{counts[state]}</span>
          <span className="faint">{formatPercent(total === 0 ? 0 : counts[state] / total, 0)}</span>
        </span>
      ))}
    </div>
  );
}

interface Band {
  state: ControlState;
  upper: number[];
  lower: number[];
}

/** Builds the stacked bands of the trend chart, best state at the bottom. */
function bands(points: readonly ReadinessTrendPoint[]): { bands: Band[]; max: number } {
  const cumulative = points.map(() => 0);
  const result: Band[] = [];
  let max = 0;
  for (const state of STATE_ORDER) {
    const lower = [...cumulative];
    const upper = points.map((point, index) => {
      cumulative[index] = (cumulative[index] ?? 0) + point.counts[state];
      return cumulative[index] ?? 0;
    });
    max = Math.max(max, ...cumulative);
    result.push({ state, upper, lower });
  }
  return { bands: result, max: Math.max(max, 1) };
}

/** Stacked area chart of the readiness trend over the last six months. */
export function TrendChart({ points }: { points: readonly ReadinessTrendPoint[] }) {
  const width = 640;
  const height = 150;
  const padX = 6;
  const padY = 10;
  if (points.length < 2) return null;
  const { bands: stacked, max } = bands(points);
  const step = (width - padX * 2) / (points.length - 1);
  const x = (index: number): number => padX + index * step;
  const y = (value: number): number => height - padY - (value / max) * (height - padY * 2);

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {stacked.map((band) => {
        const top = band.upper.map((value, index) => `${x(index)},${y(value)}`).join(' ');
        const bottom = band.lower
          .map((value, index) => `${x(index)},${y(value)}`)
          .reverse()
          .join(' ');
        return (
          <polygon
            key={band.state}
            points={`${top} ${bottom}`}
            fill={stateColor(band.state)}
            fillOpacity={0.75}
          />
        );
      })}
      {points.map((point, index) => (
        <circle
          key={point.at}
          cx={x(index)}
          cy={padY - 3}
          r={2}
          fill="var(--border-strong)"
        />
      ))}
    </svg>
  );
}

/** Axis labels of the trend chart (first, middle, last point). */
export function TrendLabels({
  points,
  format
}: {
  points: readonly ReadinessTrendPoint[];
  format: (iso: string) => string;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  return (
    <div className="row-between faint small">
      <span>{format(first.at)}</span>
      <span>{format(last.at)}</span>
    </div>
  );
}

/** Per-domain breakdown: name, stacked bar, covered share. */
export function DomainBars({
  byDomain
}: {
  byDomain: Record<string, { total: number; counts: StateCounts }>;
}) {
  return (
    <div>
      {Object.entries(byDomain).map(([domain, bucket]) => {
        const covered = bucket.counts.COVERED;
        return (
          <div className="domain-row" key={domain}>
            <span className="domain-name" title={domain}>
              {domain}
            </span>
            <StateBar counts={bucket.counts} />
            <span className="domain-value" title={`${covered} of ${bucket.total} covered`}>
              {covered}/{bucket.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}
