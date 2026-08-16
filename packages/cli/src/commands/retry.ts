import { existsSync } from 'node:fs';

import type { RunResult } from '@ai-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { handleWaitingForHuman } from '../waiting-for-human';
import { getRunDir } from '../workspace-paths';

/** Options for the `ai retry` command. */
export interface RetryOptions {
  readonly runId: string;
  readonly verbose: boolean;
  readonly json: boolean;
}

/**
 * Retry a terminal (aborted/failed) run from the state that caused the failure.
 *
 * Expects the checkpoint to have been rewritten by the caller (e.g. the dashboard
 * action handler) so that `currentState` already points to the non-terminal state
 * where the failure occurred.
 */
export async function retryCommand(
  repoRoot: string,
  options: RetryOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const { runId } = options;

  const runDir = getRunDir(runId);
  if (!existsSync(runDir)) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Run directory not found: ${runId}`,
      remediation: 'Check the run ID and try again.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  formatter.info(`Retrying run: ${runId}`);

  let ctx;
  try {
    ctx = await resumeOrchestrator(repoRoot, runId);
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  for (const w of ctx.warnings) {
    formatter.warn(w);
  }

  const state = ctx.engine.getState();
  formatter.info(`Retrying from state: ${state.currentState}`);

  formatter.startSpinner('Retrying workflow…');

  let result: RunResult;
  try {
    result = await ctx.engine.retry();

    if (result.finalState === 'WAITING_FOR_HUMAN') {
      handleWaitingForHuman(result, ctx.engine, runId, formatter);
      return ExitCode.SUCCESS;
    }
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.RUN_FAILED;
  }

  formatter.clearSpinner();

  if (result.finalState === 'DONE') {
    formatter.success('Workflow retried and completed successfully.');
    formatter.summary({
      'Run ID': result.runId,
      'Final State': result.finalState,
      Artifacts: result.artifactInventory.length,
    });
    return ExitCode.SUCCESS;
  }

  if (result.finalState === 'FAILED') {
    formatter.error({
      code: ExitCode.RUN_FAILED,
      message: 'Workflow failed during retry.',
      remediation: 'Check the journal for details.',
    });
    return ExitCode.RUN_FAILED;
  }

  if (result.finalState === 'ABORTED') {
    formatter.error({
      code: ExitCode.RUN_ABORTED,
      message: 'Workflow was aborted during retry.',
      remediation: 'Check the journal for details.',
    });
    return ExitCode.RUN_ABORTED;
  }

  formatter.summary({
    'Run ID': result.runId,
    'Final State': result.finalState,
    Artifacts: result.artifactInventory.length,
  });
  return ExitCode.SUCCESS;
}
