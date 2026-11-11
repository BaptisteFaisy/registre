/* Sign-in screen with the demonstration accounts (EF-ADM-03). */

import { useState } from 'react';
import type { DemoAccount } from '../mocks/principals.ts';
import { useApp } from '../state/app.tsx';
import { Button, Field, TextInput } from '../components/Form.tsx';
import { Card, CardBody, CardHeader, Notice } from '../components/Card.tsx';
import { ROLE_HINT, ROLE_LABEL } from '../lib/states.ts';
import { describeError } from '../lib/hooks.ts';

export function LoginScreen() {
  const { mocks, demoAccounts } = useApp();
  return (
    <div className="login-shell">
      <LoginPitch />
      <section className="login-form-side">
        <div className="login-card stack">
          <LoginForm accounts={demoAccounts} />
          <DemoAccounts accounts={demoAccounts} />
          {mocks ? (
            <Notice tone="info">
              Offline demonstration build: the data is generated for the hackathon and contains no
              real customer or partner material.
            </Notice>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LoginPitch() {
  return (
    <section className="login-pitch">
      <div className="brand">
        <span className="brand-mark">R</span>
        <span>
          <span className="brand-name">Registre</span>
          <span className="brand-sub"> audit evidence register</span>
        </span>
      </div>
      <h1 className="login-title">
        Audit preparation stops being
        <br />a hunt for documents.
      </h1>
      <p className="login-lead">
        Registre reads every document a managed service provider produces, attaches it to the
        controls it supports, checks it is fresh and complete, and keeps the register ready for the
        auditor. The tool never decides that a control is satisfactory: it says what evidence
        exists, what is missing, and what a human must verify.
      </p>
      <ul className="login-points">
        <li>Readiness by framework, with the five evidence states</li>
        <li>Every attachment justified by a quoted passage, verified by code</li>
        <li>Answers with the document, the page and the date — or no answer at all</li>
        <li>Frozen audit pack with known gaps and verified checksums</li>
      </ul>
    </section>
  );
}

interface Credentials {
  login: string;
  password: string;
}

function LoginForm({ accounts }: { accounts: readonly DemoAccount[] }) {
  const { signIn } = useApp();
  const [credentials, setCredentials] = useState<Credentials>({
    login: accounts[0]?.login ?? '',
    password: accounts[0]?.password ?? ''
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signIn(credentials.login, credentials.password);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Sign in" subtitle="Demonstration accounts for the judges" />
      <CardBody>
        <div className="stack">
          <CredentialFields credentials={credentials} onChange={setCredentials} />
          {error ? <Notice>{error}</Notice> : null}
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CredentialFields({
  credentials,
  onChange
}: {
  credentials: Credentials;
  onChange: (update: (current: Credentials) => Credentials) => void;
}) {
  return (
    <>
      <Field label="Login">
        <TextInput
          value={credentials.login}
          onChange={(login) => onChange((current) => ({ ...current, login }))}
          ariaLabel="Login"
        />
      </Field>
      <Field label="Password">
        <TextInput
          value={credentials.password}
          onChange={(password) => onChange((current) => ({ ...current, password }))}
          ariaLabel="Password"
          type="password"
        />
      </Field>
    </>
  );
}

/** One-click accounts, so a judge can switch role in the recording. */
function DemoAccounts({ accounts }: { accounts: readonly DemoAccount[] }) {
  const { signIn } = useApp();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Demo roles" subtitle="Same data behind every role, filtered by rights" />
      <CardBody>
        <div className="stack">
          {accounts.map((account) => (
            <button
              key={account.principal.id}
              type="button"
              className="demo-account"
              onClick={() => {
                setError(null);
                signIn(account.login, account.password).catch((cause: unknown) =>
                  setError(describeError(cause))
                );
              }}
            >
              <span>
                <strong>{ROLE_LABEL[account.principal.role]}</strong>
                <span className="faint small"> — {ROLE_HINT[account.principal.role]}</span>
                <br />
                <span className="demo-login">
                  {account.login} / {account.password}
                </span>
              </span>
              <span className="faint small">use</span>
            </button>
          ))}
          {error ? <Notice>{error}</Notice> : null}
        </div>
      </CardBody>
    </Card>
  );
}
