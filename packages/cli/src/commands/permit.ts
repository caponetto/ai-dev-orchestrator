import { existsSync } from 'node:fs';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { RunId, RunResult } from '@ai-dev-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getRunDir, getRunsDir } from '../workspace-paths';

import { findLatestRunWithState } from './find-run';

export interface PermitOptions {
  readonly runId: string | null;
  readonly deny: boolean;
  readonly messageId: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
}

export async function permitCommand(
  options: PermitOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestRunWithState();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No active run found.',
      remediation: 'Specify a run ID: ai permit <runId>',
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

  const runsDir = getRunsDir();

  // Route through session supervisor when a live session is waiting for permission
  const statePersistence = new DefaultStatePersistence(runsDir);
  const state = statePersistence.load(runId as RunId);

  if (
    state?.waitingContext?.liveSessionId &&
    state.waitingContext.liveRequestType === 'permission'
  ) {
    const sessionRequestId = state.waitingContext.pendingRequestId;

    if (options.messageId && options.messageId !== sessionRequestId) {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: `No pending permission request with message ID: ${options.messageId}`,
        remediation: sessionRequestId
          ? `Session has pending request: ${sessionRequestId}`
          : 'Run `ai status` to see pending requests.',
      });
      return ExitCode.GENERAL_ERROR;
    }

    const granted = !options.deny;
    const input = granted
      ? { type: 'approval' as const, content: 'Approved' }
      : { type: 'rejection' as const, content: 'Denied' };

    formatter.info(
      `Delivering permission response to session ${state.waitingContext.liveSessionId}.`,
    );

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
      result = await ctx.engine.resume(input);
    } catch (error: unknown) {
      formatter.error(toCLIError(error));
      return ExitCode.RUN_FAILED;
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          runId,
          messageId: sessionRequestId,
          action: granted ? 'granted' : 'denied',
          finalState: result.finalState,
        }) + '\n',
      );
    } else {
      const action = granted ? 'Approved' : 'Denied';
      formatter.success(
        `${action} session permission (${sessionRequestId ?? runId}). State: ${result.finalState}.`,
      );
    }

    return ExitCode.SUCCESS;
  }

  // Fallback: non-session runs use the file-backed live request store
  const store = new FileBackedLiveRequestStore(runsDir);
  const pending = await store.listPendingRequests(runId);

  const permissionRequests = pending.filter((r) => r.kind === 'permission');

  if (permissionRequests.length === 0) {
    formatter.info(`No pending permission requests for run ${runId}.`);
    return ExitCode.SUCCESS;
  }

  const target = options.messageId
    ? permissionRequests.find((r) => r.messageId === options.messageId)
    : permissionRequests[0];

  if (!target) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: options.messageId
        ? `No pending permission request with message ID: ${options.messageId}`
        : 'No pending permission requests.',
      remediation: 'Run `ai status` to see pending requests.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const granted = !options.deny;

  await store.writeResponse({
    runId,
    messageId: target.messageId,
    payload: { granted },
    respondedAt: new Date().toISOString(),
  });

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        runId,
        messageId: target.messageId,
        action: granted ? 'granted' : 'denied',
      }) + '\n',
    );
  } else {
    const action = granted ? 'Approved' : 'Denied';
    const rawDetail: unknown = target.payload['action'];
    const detail = typeof rawDetail === 'string' ? rawDetail : 'permission request';
    formatter.success(`${action} ${detail} (${target.messageId})`);
  }

  return ExitCode.SUCCESS;
}
