/* Reuse banner: what the framework gained from validated mappings. */

import type { ReuseMetric } from '../../api/types.ts';
import { Card, CardBody, CardHeader, Stat } from '../../components/Card.tsx';
import { formatDate } from '../../lib/format.ts';
import { reuseSentence, reuseStats } from '../../lib/mappings.ts';

/** Headline counters of "one evidence serves every framework". */
export function ReuseBanner({ reuse }: { reuse: ReuseMetric }) {
  const stats = reuseStats(reuse);
  return (
    <Card>
      <CardHeader
        title="One evidence serves every framework"
        subtitle={`Computed ${formatDate(reuse.computedAt)} — ${reuseSentence(reuse)}`}
      />
      <CardBody>
        <div className="stat-grid">
          {stats.map((stat) => (
            <Stat key={stat.label} value={stat.value} label={stat.label} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
