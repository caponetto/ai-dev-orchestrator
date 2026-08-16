import { existsSync } from 'node:fs';

import type { RunResult } from '@ai-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getRunDir } from '../workspace-paths';

import { findLatestRunWithState } from './find-run';

export interface ApproveOptions {
  readonly runId: string | null;
  readonly reject: boolean;
  readonly message: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
}

export async function approveCommand(
  options: ApproveOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestRunWithState();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No active run found.',
      remediation: 'Specify a run ID: ai approve <runId>',
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

  const action = options.reject ? 'rejection' : 'approval';
  const content = options.message ?? `${options.reject ? 'Rejected' : 'Approved'} via CLI`;

  formatter.info(`${options.reject ? 'Rejecting' : 'Approving'} run: ${runId}`);

  let ctx;
  try {
    ctx = await resumeOrchestrator(process.cwd(), runId);
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  for (const w of ctx.warnings) {
    formatter.warn(w);
  }

  let result: RunResult;
  try {
    result = await ctx.engine.resume({ type: action, content });
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.RUN_FAILED;
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        runId,
        status: action,
        finalState: result.finalState,
        artifacts: result.artifactInventory.length,
      }) + '\n',
    );
  } else {
    if (result.finalState === 'DONE') {
      formatter.success(
        `Run ${runId} ${action === 'rejection' ? 'rejected' : 'approved'} and completed.`,
      );
    } else {
      formatter.success(
        `Run ${runId} ${action === 'rejection' ? 'rejected' : 'approved'}. State: ${result.finalState}.`,
      );
    }
    formatter.summary({
      'Run ID': result.runId,
      'Final State': result.finalState,
      Artifacts: result.artifactInventory.length,
    });
  }

  return options.reject ? ExitCode.RUN_ABORTED : ExitCode.SUCCESS;
}
