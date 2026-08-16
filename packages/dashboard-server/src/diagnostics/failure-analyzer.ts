import type { ErrorChainEntry, FailureAnalysis } from '@ai-orchestrator/schemas';
interface FailureEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

export interface RunFailureContext {
  readonly runId: string;
  readonly finalState: string;
  readonly completedAt: string;
  readonly events: readonly FailureEvent[];
}

export function analyzeRunFailure(context: RunFailureContext): FailureAnalysis {
  const errorChain: ErrorChainEntry[] = context.events.map((e) => ({
    source: e.source,
    code: e.code,
    message: e.message,
    timestamp: e.timestamp,
  }));

  const rootCause =
    errorChain.length > 0
      ? errorChain[0].message
      : `Workflow stopped at state ${context.finalState} with no error events`;

  const contributingFactors = extractContributingFactors(context.events);
  const recommendation = deriveRecommendation(context.finalState, context.events);

  return {
    runId: context.runId,
    failedAt: context.completedAt,
    failedState: context.finalState,
    rootCause,
    contributingFactors,
    errorChain,
    recommendation,
  };
}

function extractContributingFactors(events: readonly FailureEvent[]): readonly string[] {
  const factors: string[] = [];
  const sources = new Set(events.map((e) => e.source));

  if (sources.size > 1) {
    factors.push(`Multiple subsystems involved: ${[...sources].join(', ')}`);
  }

  const agentErrors = events.filter(
    (e) => e.source.includes('agent') || e.source.includes('runner'),
  );
  if (agentErrors.length > 0) {
    factors.push('Agent runner errors detected — check agent configuration');
  }

  const timeoutErrors = events.filter((e) => e.code.includes('TIMEOUT'));
  if (timeoutErrors.length > 0) {
    factors.push('Timeout errors detected — consider increasing timeout limits');
  }

  return factors;
}

function deriveRecommendation(finalState: string, events: readonly FailureEvent[]): string {
  if (events.length === 0) {
    return `Review workflow definition — state ${finalState} has no outbound transitions or guards failed`;
  }

  const lastError = events[events.length - 1];

  if (lastError.source.includes('agent') || lastError.source.includes('runner')) {
    return 'Check agent runner configuration and ensure the runner is available';
  }

  if (lastError.code.includes('GOVERNANCE')) {
    return 'Review governance policy — a required approval may be missing';
  }

  if (lastError.code.includes('ARTIFACT')) {
    return 'Check artifact store — a required artifact may be missing or corrupted';
  }

  return `Investigate ${lastError.source}: ${lastError.message}`;
}
