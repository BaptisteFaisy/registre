/* Sharing with an external auditor: bounded, watermarked, revocable access. */

import { useState } from 'react';
import type { ShareGrant } from '../../api/types.ts';
import { Card, CardBody, CardHeader, ErrorState } from '../../components/Card.tsx';
import { Button, Field, TextInput } from '../../components/Form.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { Spinner } from '../../components/Primitives.tsx';
import {
  SHARE_TTL_CHOICES,
  parseShareInput
} from '../../lib/verify.ts';
import { shareColumns } from './shareColumns.tsx';
import type { Loadable } from '../../state/useData.ts';

interface SharePanelProps {
  packId: string | null;
  shares: Loadable<ShareGrant[]>;
  onCreate: (input: { ttlHours: number; watermarkLabel: string }) => Promise<string | null>;
  onRevoke: (token: string) => Promise<string | null>;
  busy: boolean;
}

/** Share form and the table of every grant, with revocation. */
export function SharePanel({ packId, shares, onCreate, onRevoke, busy }: SharePanelProps) {
  return (
    <Card>
      <CardHeader
        title="Share with an auditor"
        subtitle="A share narrows access, it never widens it: one pack, a watermark, an expiry, revocable, and every use is journalled."
      />
      <CardBody>
        <ShareForm packId={packId} busy={busy} onCreate={onCreate} />
        <ShareTable shares={shares} busy={busy} onRevoke={onRevoke} />
      </CardBody>
    </Card>
  );
}

/** Lifetime and label of the grant; the bounds are the API's (1 to 168 h). */
function ShareForm({
  packId,
  busy,
  onCreate
}: {
  packId: string | null;
  busy: boolean;
  onCreate: SharePanelProps['onCreate'];
}) {
  const [ttl, setTtl] = useState('24');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = parseShareInput(ttl, label);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const failure = await onCreate(parsed.input);
    setError(failure);
    if (!failure) setLabel('');
  };

  return (
    <>
      <div className="row share-form">
        <Field label="Lifetime (hours, 1–168)">
          <TextInput value={ttl} onChange={setTtl} ariaLabel="Share lifetime in hours" />
        </Field>
        <Field label="Recipient label" grow>
          <TextInput
            value={label}
            onChange={setLabel}
            placeholder="e.g. KPMG external audit"
            ariaLabel="Recipient label"
          />
        </Field>
        <Button variant="primary" onClick={submit} disabled={busy || !packId}>
          {busy ? 'Opening…' : 'Open the share'}
        </Button>
      </div>
      <TtlChoices onPick={(hours) => setTtl(String(hours))} />
      {error ? <ErrorState message={error} /> : null}
    </>
  );
}

/** Quick lifetime choices, all within the bounds the API accepts. */
function TtlChoices({ onPick }: { onPick: (hours: number) => void }) {
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      {SHARE_TTL_CHOICES.map((choice) => (
        <Button key={choice.hours} size="sm" variant="ghost" onClick={() => onPick(choice.hours)}>
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

/** Every grant with its state, use counter and two-step revocation. */
function ShareTable({
  shares,
  busy,
  onRevoke
}: {
  shares: Loadable<ShareGrant[]>;
  busy: boolean;
  onRevoke: SharePanelProps['onRevoke'];
}) {
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (shares.error) return <ErrorState message={shares.error} onRetry={shares.reload} />;
  if (shares.loading) return <Spinner label="Loading the grants…" />;
  const now = new Date().toISOString();
  const revoke = async (token: string): Promise<void> => {
    setConfirmToken(null);
    setError(await onRevoke(token));
  };
  return (
    <>
      {error ? <ErrorState message={error} /> : null}
      <DataTable
        columns={shareColumns({ now, confirmToken, busy, onAskRevoke: setConfirmToken, onRevoke: revoke })}
        rows={shares.data ?? []}
        rowKey={(share) => share.token}
        empty="No share opened yet."
      />
    </>
  );
}
