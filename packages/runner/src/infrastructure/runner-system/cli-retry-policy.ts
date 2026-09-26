import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentResult } from '@ai-dev-orchestrator/schemas';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
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
): Promise<AgentResult> {
  if (!adapterName || !SUPPORTED_ADAPTERS.has(adapterName)) {
    return execute(timeoutMs, onStreamEvent);
  }

  const startedAt = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const toolEvents: AgentOutputStreamEvent[] = [];
    const result = await execute(Math.max(1, timeoutMs - (Date.now() - startedAt)), (event) => {
      if (
        event.structuredData?.['phase'] === 'tool_call' ||
        event.structuredData?.['phase'] === 'tool_result'
      ) {
        toolEvents.push(event);
      }
      onStreamEvent?.(event);
    });

    if (
      result.status === 'success' ||
      !result.recoverable ||
      toolEvents.length > 0 ||
      (result.tokenUsage?.inputTokens ?? 0) > 0 ||
      (result.tokenUsage?.outputTokens ?? 0) > 0 ||
      attempt === MAX_ATTEMPTS ||
      Date.now() - startedAt + RETRY_DELAY_MS >= timeoutMs
    ) {
      return result;
    }

    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Retrying transient ${adapterName} error (attempt ${String(attempt + 1)}/${String(MAX_ATTEMPTS)})`,
    });
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new Error('CLI retry loop ended without a result');
}
