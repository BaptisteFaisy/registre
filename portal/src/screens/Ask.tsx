/* Natural-language questions over the register, with citations or a clear
   "no evidence" answer (EF-QR-01, EF-QR-02, EF-QR-03). */

import { useState } from 'react';
import type { Answer } from '../api/types.ts';
import { useApp } from '../state/app.tsx';
import { Card, CardBody, Notice } from '../components/Card.tsx';
import { Button, Field, TextInput } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { AnswerPanel } from './ask/AnswerPanel.tsx';
import { describeError } from '../lib/hooks.ts';

const SUGGESTIONS = [
  'Show the last backup restore test and its recovery time',
  'When was the information security policy last reviewed?',
  'What evidence supports the incident register for October?',
  'What is our mean time to hire for the service desk?'
];

export function AskScreen() {
  const { api } = useApp();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setQuestion(trimmed);
    try {
      setAnswer(await api.ask(trimmed));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Ask the register"
        subtitle="The answer is written from the passages found in the evidence, each cited with its document, page and date. When nothing answers, the register says so."
      />
      <QuestionCard question={question} busy={busy} onChange={setQuestion} onAsk={ask} />
      {error ? <Notice>{error}</Notice> : null}
      {busy ? <Spinner label="Reading the evidence…" /> : null}
      {answer && !busy ? <AnswerPanel answer={answer} /> : null}
    </div>
  );
}

function QuestionCard({
  question,
  busy,
  onChange,
  onAsk
}: {
  question: string;
  busy: boolean;
  onChange: (value: string) => void;
  onAsk: (text: string) => void;
}) {
  return (
    <Card>
      <CardBody>
        <div className="ask-form">
          <Field label="Question" grow>
            <TextInput
              ariaLabel="Your question"
              value={question}
              onChange={onChange}
              placeholder="Show the last restore test and its recovery time"
            />
          </Field>
          <Button variant="primary" onClick={() => onAsk(question)} disabled={busy}>
            {busy ? 'Searching…' : 'Ask'}
          </Button>
        </div>
        <div className="suggestions" style={{ marginTop: 10 }}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion"
              onClick={() => onAsk(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
