import type { RunResult } from '@ai-dev-orchestrator/schemas';

import { ExitCode } from './exit-codes';
import type { OutputFormatter } from './formatter';

/** Interpret observed engine state, independently of the command or requested action. */
export function workflowResultFields(result: RunResult) {
  const outcome =
    result.finalState === 'DONE'
      ? 'completed'
      : result.finalState === 'FAILED'
        ? 'failed'
        : result.finalState === 'ABORTED'
          ? 'aborted'
          : result.finalState === 'WAITING_FOR_HUMAN'
            ? 'waiting'
            : 'returned';
  const exitCode =
    result.finalState === 'FAILED'
      ? ExitCode.RUN_FAILED
      : result.finalState === 'ABORTED'
        ? ExitCode.RUN_ABORTED
        : ExitCode.SUCCESS;
  return { runId: result.runId, finalState: result.finalState, outcome, exitCode };
}

/** A completed command may have observed a failed workflow rather than successful input handling. */
export function reportWorkflowFailure(result: RunResult, formatter: OutputFormatter): boolean {
  const fields = workflowResultFields(result);
  if (fields.exitCode === ExitCode.SUCCESS) {
    return false;
  }
  formatter.error({
    code: fields.exitCode,
    message: `Workflow ${fields.outcome}. Final state: ${fields.finalState}.`,
    remediation: 'Check the journal for details.',
  });
  return true;
}
