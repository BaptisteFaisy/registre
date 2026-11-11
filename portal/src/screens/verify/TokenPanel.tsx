/* "Verify a pack by link": the auditor side of a share grant. */

import { useState } from 'react';
import type { VerificationResult } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { Card, CardBody, CardHeader, ErrorState, Notice } from '../../components/Card.tsx';
import { Button, Field, TextInput } from '../../components/Form.tsx';
import { describeError } from '../../lib/hooks.ts';
import { VerdictCard } from './VerdictCard.tsx';

/** Token entry and its verification result — what an external auditor sees. */
export function TokenPanel() {
  const { api } = useApp();
  const [token, setToken] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.verifyByToken(token.trim()));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Verify a pack by link"
        subtitle="Paste the token of a share grant: this is exactly what an external auditor gets — verdicts and hashes, never a document."
      />
      <CardBody>
        <div className="row share-form">
          <Field label="Share token" grow>
            <TextInput
              value={token}
              onChange={setToken}
              placeholder="token received with the share link"
              ariaLabel="Share token"
            />
          </Field>
          <Button variant="primary" onClick={verify} disabled={busy || token.trim().length === 0}>
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
        {error ? <ErrorState message={error} /> : null}
        {result ? <TokenResult result={result} /> : null}
      </CardBody>
    </Card>
  );
}

/** The auditor's verdict, and why the grant can never widen access. */
function TokenResult({ result }: { result: VerificationResult }) {
  return (
    <>
      <div style={{ marginTop: 12 }}>
        <VerdictCard result={result} compact />
      </div>
      <Notice tone="info">
        The grant only narrows access: one pack, a watermark on every excerpt, an expiry and a
        use counter the register journals. Revoking the grant closes the link immediately.
      </Notice>
    </>
  );
}
