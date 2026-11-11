/* Simple SVG trend of one subject × metric, with its target line. */

import type { QualityTableRow } from '../../lib/quality.ts';
import { METRIC_META } from '../../lib/quality.ts';

const WIDTH = 640;
const HEIGHT = 150;
const PAD_X = 24;
const PAD_Y = 18;

interface Geometry {
  x: (index: number) => number;
  y: (value: number) => number;
  low: number;
  high: number;
}

/** Scales the value series and the target into the viewBox. */
function geometryOf(values: readonly number[], target: number): Geometry {
  const low = Math.min(target, ...values);
  const high = Math.max(target, ...values);
  const span = high - low || 1;
  const count = Math.max(values.length - 1, 1);
  return {
    x: (index) => PAD_X + (index * (WIDTH - PAD_X * 2)) / count,
    y: (value) => HEIGHT - PAD_Y - ((value - low) / span) * (HEIGHT - PAD_Y * 2),
    low,
    high
  };
}

/** One polyline, one dashed target, one dot per measurement. */
export function TrendSvg({ row }: { row: QualityTableRow }) {
  const meta = METRIC_META[row.metric];
  const geometry = geometryOf(row.trendValues, row.target);
  const points = row.trendValues.map((value, index) => `${geometry.x(index)},${geometry.y(value)}`);
  const stroke = row.verdict === 'FAIL' ? 'var(--bad)' : 'var(--ok)';

  return (
    <svg
      className="trend-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Trend of ${row.metricLabel} for ${row.subjectLabel}`}
    >
      <line
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={geometry.y(row.target)}
        y2={geometry.y(row.target)}
        stroke="var(--border-strong)"
        strokeDasharray="5 4"
      />
      <text x={WIDTH - PAD_X} y={geometry.y(row.target) - 5} textAnchor="end" className="trend-label">
        target {row.targetLabel}
      </text>
      <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth={2} />
      {row.trendValues.map((value, index) => (
        <circle key={index} cx={geometry.x(index)} cy={geometry.y(value)} r={3.5} fill={stroke} />
      ))}
      <text x={PAD_X} y={HEIGHT - 4} className="trend-label">
        {meta?.description ?? row.metricLabel}
      </text>
      <text x={WIDTH - PAD_X} y={HEIGHT - 4} textAnchor="end" className="trend-label">
        latest {row.valueLabel}
      </text>
    </svg>
  );
}
