/* Verification verdicts: the three checks, the root hash and the counters. */

import type { VerificationResult } from '../../api/types.ts';
import { Card, CardBody, CardHeader, KeyValue, Notice } from '../../components/Card.tsx';
import { Badge } from '../../components/Primitives.tsx';
import { formatDateTime } from '../../lib/format.ts';
import {
  OVERALL_META,
  VERDICT_META,
  overallVerdict,
  verdictRows
} from '../../lib/verify.ts';

/** Full verdict card: headline, the three checks and the pack counters. */
export function VerdictCard({
  result,
  compact = false
}: {
  result: VerificationResult;
  compact?: boolean;
}) {
  const overall = OVERALL_META[overallVerdict(result)];
  return (
    <Card>
      <CardHeader
        title={`Verification of ${result.packId}`}
        subtitle={`Frozen ${formatDateTime(result.frozenAt)} · verified ${formatDateTime(result.verifiedAt)}`}
        action={<Badge label={overall.label} color={overall.color} />}
      />
      <CardBody>
        <div className="verdict-list">
          {verdictRows(result).map((row) => {
            const meta = VERDICT_META[row.value];
            return (
              <div className="verdict-row" key={row.key}>
                <span>{row.label}</span>
                <Badge label={meta.label} color={meta.color} />
                <span className="faint small">{row.description}</span>
              </div>
            );
          })}
        </div>
        <div className="root-hash">
          <span className="label">Root hash of the manifest</span>
          <span className="hash">{result.rootHash}</span>
        </div>
        {compact ? null : <VerificationCounters result={result} />}
      </CardBody>
    </Card>
  );
}

function VerificationCounters({ result }: { result: VerificationResult }) {
  return (
    <>
      <KeyValue
        items={[
          { label: 'Framework', value: <span className="mono">{result.frameworkId}</span> },
          { label: 'Controls in the pack', value: String(result.controlCount) },
          { label: 'Evidence fingerprints', value: String(result.evidenceCount) },
          { label: 'Known gaps', value: String(result.knownGapCount) },
          { label: 'Signing algorithm', value: result.algorithm },
          { label: 'Signing key', value: <span className="mono">{result.signerKeyId ?? '—'}</span> }
        ]}
      />
      <Notice tone="info">
        <strong>Why a verifier needs no content.</strong> Checking a pack means recomputing
        hashes, not reading documents: the manifest lists only identifiers, fingerprints and
        states. The verdicts above prove the archive is exactly what was frozen — without a
        single title, quote or name leaving the register.
      </Notice>
    </>
  );
}
