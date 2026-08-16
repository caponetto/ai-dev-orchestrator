import { useState } from 'react';

import { api } from '../api/client';

import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export function AnswerForm({
  runId,
  reason,
  requestingState,
  onSuccess,
}: {
  runId: string;
  reason: string;
  requestingState: string;
  onSuccess: () => void;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!content.trim()) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.answer(runId, content.trim());
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? 'Unknown error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const contextLabel =
    reason === 'clarification_needed'
      ? 'The agent needs clarification before proceeding.'
      : `Waiting for input from ${requestingState.replaceAll('_', ' ').toLowerCase()}.`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{contextLabel}</p>
      <Textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
        }}
        placeholder="Type your response..."
        rows={4}
        aria-required="true"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        variant="default"
        size="sm"
        disabled={submitting || !content.trim()}
        onClick={() => void submit()}
      >
        {submitting ? 'Submitting...' : 'Submit Answer'}
      </Button>
    </div>
  );
}
