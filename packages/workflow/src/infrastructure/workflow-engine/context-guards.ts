import type { ProjectContextStore } from '@ai-orchestrator/ports';
import type { FailurePattern, Guard, GuardResult, RunHistoryEntry } from '@ai-orchestrator/schemas';

type PreviousRunPatternGuard = Extract<Guard, { type: 'previous_run_pattern' }>;
type KnownFailurePatternGuard = Extract<Guard, { type: 'known_failure_pattern' }>;

export async function evaluatePreviousRunPatternGuard(
  guard: PreviousRunPatternGuard,
  store: ProjectContextStore,
): Promise<GuardResult> {
  const doc = await store.read('run_history');
  if (!doc) {
    return { guard, passed: false, detail: 'No run history available' };
  }

  const history = doc.content as { runs?: readonly RunHistoryEntry[] };
  const runs = history.runs ?? [];

  const matching = runs.filter((run) => {
    if (run.outcome !== guard.params.outcome) {
      return false;
    }
    if (guard.params.workflowVariant && run.workflowVariant !== guard.params.workflowVariant) {
      return false;
    }
    return true;
  });

  const threshold = guard.params.minOccurrences ?? 1;
  const passed = matching.length >= threshold;

  return {
    guard,
    passed,
    detail: passed
      ? `Found ${String(matching.length)} run(s) matching outcome "${guard.params.outcome}" (threshold: ${String(threshold)})`
      : `Only ${String(matching.length)} run(s) match outcome "${guard.params.outcome}" (need ${String(threshold)})`,
  };
}

export async function evaluateKnownFailurePatternGuard(
  guard: KnownFailurePatternGuard,
  store: ProjectContextStore,
): Promise<GuardResult> {
  const doc = await store.read('preferences');
  if (!doc) {
    return { guard, passed: false, detail: 'No learned preferences available' };
  }

  const prefs = doc.content as { failurePatterns?: readonly FailurePattern[] };
  const patterns = prefs.failurePatterns ?? [];

  const match = patterns.find((p) =>
    p.pattern.toLowerCase().includes(guard.params.patternSubstring.toLowerCase()),
  );

  if (match) {
    return {
      guard,
      passed: true,
      detail: `Known failure pattern found: "${match.pattern}" (seen ${String(match.frequency)} time(s))`,
    };
  }

  return {
    guard,
    passed: false,
    detail: `No known failure pattern matching "${guard.params.patternSubstring}"`,
  };
}
