import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { RUN_LOCK_FILENAME } from '@ai-orchestrator/schemas';

import { TERMINAL_STATES, buildAbortedState, writeAbortJournalEntries } from '../abort-run';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { readLockMetadata, recoverRunState, terminateRunFromLock } from '../run-state-recovery';
import { getRunsDir } from '../workspace-paths';

import { findLatestRunWithState } from './find-run';

export interface AbortOptions {
  readonly runId: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly force: boolean;
}

export async function abortCommand(
  options: AbortOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestRunWithState();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No active run found.',
      remediation: 'Specify a run ID: ai abort <runId>',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const runsDir = getRunsDir();
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Run directory not found: ${runId}`,
      remediation: 'Check the run ID and try again.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const statePersistence = new DefaultStatePersistence(runsDir);
  const recovered = recoverRunState(runsDir, runId);
  const state = recovered.state;

  if (!state) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `No state found for run: ${runId}`,
      remediation: 'The run has no checkpoint, journal, or lock file to reconstruct from.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  if (recovered.source === 'lock' && !options.force) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Run ${runId} has not checkpointed yet.`,
      remediation: 'Retry with --force to terminate the live process from run.lock.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  if (TERMINAL_STATES.has(state.currentState)) {
    if (options.json) {
      process.stdout.write(
        JSON.stringify({ runId, status: 'already_terminal', state: state.currentState }) + '\n',
      );
    } else {
      formatter.info(`Run ${runId} is already in terminal state: ${state.currentState}`);
    }
    return ExitCode.SUCCESS;
  }

  const lockPath = join(runDir, RUN_LOCK_FILENAME);
  const lock = recovered.lock ?? readLockMetadata(lockPath);
  terminateRunFromLock(lock);

  try {
    await statePersistence.save(buildAbortedState(state));
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.GENERAL_ERROR;
  }

  try {
    writeAbortJournalEntries(runsDir, runId, state, 'Aborted via CLI');
  } catch {
    // Journal write failure is non-fatal for abort
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        runId,
        status: 'aborted',
        previousState: state.currentState,
      }) + '\n',
    );
  } else {
    formatter.success(`Run ${runId} aborted (was in state: ${state.currentState}).`);
  }

  return ExitCode.RUN_ABORTED;
}
