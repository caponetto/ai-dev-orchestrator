import { useState } from 'react';

import { api } from '../api/client';

import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

/** Reply to a live request without launching a second workflow process. */
export function LiveClarificationForm({
  runId,
  messageId,
  answered,
  expired,
}: Readonly<{
  runId: string;
  messageId: string;
  answered: boolean;
  expired: boolean;
}>) {
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!answer.trim() || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.respondClarification(runId, messageId, answer.trim());
      setSubmitted(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  if (answered || submitted) {
    return <p className="mt-2 text-emerald-400">Answer submitted</p>;
  }
  if (expired) {
    return <p className="mt-2 text-muted-foreground">Request expired (agent finished)</p>;
  }
  return (
    <form
      aria-label="Answer clarification"
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label="Clarification answer"
        value={answer}
        disabled={loading}
        onChange={(event) => {
          setAnswer(event.target.value);
        }}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="xs" disabled={loading || !answer.trim()}>
        {loading ? 'Sending...' : 'Send answer'}
      </Button>
    </form>
  );
}
