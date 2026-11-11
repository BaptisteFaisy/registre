/* Verify & share: third-party verification of a frozen pack (axis 1). */

import { Card, CardBody, CardHeader, ErrorState, Notice } from '../components/Card.tsx';
import { Field, Select } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { SharePanel } from './verify/SharePanel.tsx';
import { TokenPanel } from './verify/TokenPanel.tsx';
import { VerdictCard } from './verify/VerdictCard.tsx';
import { useVerifyScreen } from './verify/useVerifyScreen.ts';

export function VerifyScreen({ packId }: { packId: string | null }) {
  const state = useVerifyScreen(packId);
  const verification = state.verification.data;

  return (
    <div className="stack">
      <PageHeader
        title="Verify & share"
        subtitle="A third party checks a frozen pack without trusting us: fingerprints, hash chain and signature — never a document."
      />
      <PackSelector state={state} />
      {state.packs.error ? <ErrorState message={state.packs.error} onRetry={state.packs.reload} /> : null}
      {state.verification.error ? (
        <ErrorState message={state.verification.error} onRetry={state.verification.reload} />
      ) : null}
      {state.verification.loading && !verification ? <Spinner label="Recomputing the hashes…" /> : null}
      {verification ? <VerdictCard result={verification} /> : null}
      <SharePanel
        packId={state.selectedId}
        shares={state.shares}
        onCreate={state.createShare}
        onRevoke={state.revoke}
        busy={state.busy}
      />
      <TokenPanel />
    </div>
  );
}

/** Chooses which frozen pack to verify. */
function PackSelector({ state }: { state: ReturnType<typeof useVerifyScreen> }) {
  const packs = state.packs.data ?? [];
  if (packs.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Pack under verification" subtitle="Each pack is verified on demand; the verdict is journalled." />
      <CardBody>
        <div className="row">
          <Field label="Frozen pack">
            <Select
              ariaLabel="Pack to verify"
              value={state.selectedId ?? ''}
              options={packs.map((pack) => ({
                value: pack.id,
                label: `${pack.id} — frozen ${pack.frozenAt.slice(0, 10)}`
              }))}
              onChange={state.select}
            />
          </Field>
          {state.verification.data && !state.verification.data.checksumsOk ? (
            <Notice>This archive was altered after the freeze: the checksum verdict shows it.</Notice>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
