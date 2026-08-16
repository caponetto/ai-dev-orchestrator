import type { WorkflowEngine } from '@ai-orchestrator/ports';
import type { RunResult } from '@ai-orchestrator/schemas';

import type { OutputFormatter } from './output/formatter';

export function handleWaitingForHuman(
  result: RunResult,
  engine: WorkflowEngine,
  runId: string,
  formatter: OutputFormatter,
): void {
  formatter.clearSpinner();

  const state = engine.getState();
  const wc = state.waitingContext;

  if (wc?.budgetExhaustion) {
    const be = wc.budgetExhaustion;
    const label = `${String(be.current)} / ${String(be.limit)} tokens`;
    const roleSuffix = be.role ? `, role: ${be.role}` : '';
    formatter.info(
      `Budget exhausted (${label}${roleSuffix}). Use \`ai approve ${runId}\` to continue.`,
    );
  } else if (wc?.requiredInput === 'text') {
    formatter.info(
      `Run paused: ${wc.reason}. Use \`ai answer ${runId} "your answer"\` to continue.`,
    );
  } else if (wc) {
    formatter.info(`Run paused: ${wc.reason}. Use \`ai approve ${runId}\` to continue.`);
  } else {
    formatter.info(`Run paused at ${result.finalState}. Use \`ai resume ${runId}\` to continue.`);
  }
}
