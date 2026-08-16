import { existsSync } from 'node:fs';

import type { PersistedState, RunId, RunResult } from '@ai-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { handleWaitingForHuman } from '../waiting-for-human';
import { getRunDir } from '../workspace-paths';

import { findLatestInterruptedRun } from './find-run';

/** Options for the `ai resume` command. */
export interface ResumeOptions {
  readonly runId: string | null;
  readonly verbose: boolean;
  readonly json: boolean;
}

/** Resume an interrupted orchestrator run, optionally auto-approving gates. */
export async function resumeCommand(
  repoRoot: string,
  options: ResumeOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestInterruptedRun();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No interrupted run found.',
      remediation: 'Specify a run ID: ai resume <runId>',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const runDir = getRunDir(runId);
  if (!existsSync(runDir)) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Run directory not found: ${runId}`,
      remediation: 'Check the run ID and try again.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  formatter.info(`Resuming run: ${runId}`);

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

  let checkpoint: PersistedState | null = null;
  let loadFailed = false;
  try {
    checkpoint = ctx.statePersistence.load(runId as RunId);
  } catch {
    loadFailed = true;
  }
  if (!checkpoint) {
    checkpoint = ctx.statePersistence.reconstructFromJournal(
      runId as RunId,
      ctx.journalReader.readAll(),
    );
    if (checkpoint) {
      const reason = loadFailed ? 'Checkpoint corrupt' : 'Checkpoint missing';
      formatter.info(`${reason} — reconstructed state from journal`);
    }
  }
  if (!checkpoint) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `No checkpoint found for run: ${runId}`,
      remediation:
        'The run may not have been checkpointed and has no journal to reconstruct from. Start a new run instead.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  formatter.info(`Resuming from state: ${checkpoint.currentState}`);

  const wc = checkpoint.waitingContext;
  if (wc?.requiredInput === 'text') {
    formatter.error({
      code: ExitCode.INVALID_ARGUMENTS,
      message: 'This run is waiting for text input, not approval.',
      remediation: `Use \`ai answer ${runId} "your response"\` instead.`,
    });
    return ExitCode.INVALID_ARGUMENTS;
  }

  formatter.startSpinner('Resuming workflow…');

  let result: RunResult;
  try {
    result = await ctx.engine.resume({ type: 'approval', content: 'Resumed via CLI' });

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
    formatter.success('Workflow resumed and completed successfully.');
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
      message: 'Workflow failed during resume.',
      remediation: 'Check the journal for details.',
    });
    return ExitCode.RUN_FAILED;
  }

  if (result.finalState === 'ABORTED') {
    formatter.error({
      code: ExitCode.RUN_ABORTED,
      message: 'Workflow was aborted during resume.',
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
