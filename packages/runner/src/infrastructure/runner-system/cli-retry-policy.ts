import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentResult } from '@ai-dev-orchestrator/schemas';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;
const BACKOFF_FACTOR = 2.5;

/** Exponential backoff (2s, 5s, ...) with up to 50% of the base delay added as jitter. */
export function computeRetryDelayMs(
  retryNumber: number,
  baseDelayMs: number,
  random: () => number = Math.random,
): number {
  return Math.round(
    baseDelayMs * BACKOFF_FACTOR ** (retryNumber - 1) + random() * (baseDelayMs / 2),
  );
}
const SUPPORTED_ADAPTERS: ReadonlySet<string> = new Set([
  BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
  BUILT_IN_CODING_RUNNER_ID.CODEX,
  BUILT_IN_CODING_RUNNER_ID.CURSOR,
  BUILT_IN_CODING_RUNNER_ID.OPENCODE,
]);

/** Retry only failures that happened before an agent could have changed the workspace. */
export async function dispatchWithTransientRetry(
  adapterName: string | undefined,
  timeoutMs: number,
  execute: (
    remainingTimeoutMs: number,
    onEvent?: (event: AgentOutputStreamEvent) => void,
  ) => Promise<AgentResult>,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
): Promise<AgentResult> {
  if (!adapterName || !SUPPORTED_ADAPTERS.has(adapterName)) {
    return execute(timeoutMs, onStreamEvent);
  }

  const startedAt = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const toolEvents: AgentOutputStreamEvent[] = [];
    const missingOutput: boolean[] = [];
    const result = await execute(Math.max(1, timeoutMs - (Date.now() - startedAt)), (event) => {
      if (
        event.structuredData?.['phase'] === 'tool_call' ||
        event.structuredData?.['phase'] === 'tool_result'
      ) {
        toolEvents.push(event);
      }
      if (event.structuredData?.['code'] === 'missing_output_artifact') {
        missingOutput.push(true);
      }
      onStreamEvent?.(event);
    });

    // An agent that exited without any tool call and without its artifact (e.g. it only
    // greeted and stopped) cannot have touched the workspace, so it is safe to retry.
    const exitedWithoutWork = result.status === 'failure' && missingOutput.length > 0;
    const hasUsage =
      (result.tokenUsage?.inputTokens ?? 0) > 0 || (result.tokenUsage?.outputTokens ?? 0) > 0;

    const delayMs = computeRetryDelayMs(attempt, baseDelayMs);

    if (
      result.status === 'success' ||
      toolEvents.length > 0 ||
      (!exitedWithoutWork && (!result.recoverable || hasUsage)) ||
      attempt === MAX_ATTEMPTS ||
      Date.now() - startedAt + delayMs >= timeoutMs
    ) {
      return result;
    }

    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Retrying transient ${adapterName} error (attempt ${String(attempt + 1)}/${String(MAX_ATTEMPTS)})`,
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('CLI retry loop ended without a result');
}
