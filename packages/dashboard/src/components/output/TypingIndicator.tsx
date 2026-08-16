import { useEffect, useState } from 'react';

const ELAPSED_DELAY_MS = 5000;

const STATE_LABELS: Record<string, string> = {
  INTAKE: 'Analyzing requirements',
  REFINEMENT: 'Refining requirements',
  CODEBASE_ANALYSIS: 'Scanning codebase',
  PLANNING: 'Creating plan',
  PLAN_REVIEW: 'Reviewing plan',
  IMPLEMENTATION: 'Implementing',
  TEST_AUTHORING: 'Writing tests',
  CODE_REVIEW: 'Reviewing code',
  REVIEW_SYNTHESIS: 'Synthesizing reviews',
  REMEDIATION_TRIAGE: 'Triaging findings',
  JUDGE_REVIEW: 'Arbitrating review',
  TEST_EXECUTION: 'Running tests',
  ACCEPTANCE_VALIDATION: 'Validating acceptance',
  WRAP_UP: 'Wrapping up',
};

function humanizeState(state: string | undefined): string {
  if (!state) {
    return 'Working';
  }
  return (
    STATE_LABELS[state] ??
    state
      .replaceAll(/[_-]/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function TypingIndicator({
  lastTimestamp,
  currentState,
}: Readonly<{ lastTimestamp?: string; currentState?: string }>) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!lastTimestamp) {
      return;
    }
    const update = () => {
      const secs = Math.max(0, Math.floor((Date.now() - new Date(lastTimestamp).getTime()) / 1000));
      if (secs < ELAPSED_DELAY_MS / 1000) {
        setElapsed('');
        return;
      }
      if (secs < 60) {
        setElapsed(`${String(secs)}s`);
      } else {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        setElapsed(`${String(m)}m ${String(s)}s`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => {
      clearInterval(id);
    };
  }, [lastTimestamp]);

  return (
    <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground/80">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      <span>
        {humanizeState(currentState)}
        <span className="motion-safe:animate-pulse">...</span>
        {elapsed ? ` · ${elapsed}` : ''}
      </span>
    </div>
  );
}
