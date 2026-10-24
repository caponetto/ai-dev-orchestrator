import { existsSync } from 'node:fs';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { RunId, RunResult } from '@ai-dev-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { reportWorkflowFailure, workflowResultFields } from '../output/workflow-result';
import { loadLatestRunState } from '../run-state-recovery';
import { getJournalPath, getRunDir, getRunsDir } from '../workspace-paths';

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
  if (options.messageId !== null && !options.messageId.trim()) {
    formatter.error({
      code: ExitCode.INVALID_ARGUMENTS,
      message: 'Permission message ID must be non-empty.',
      remediation: 'Specify a request ID from `ai status`, or omit --message-id.',
    });
    return ExitCode.INVALID_ARGUMENTS;
  }

  const runsDir = getRunsDir();

  // Route through session supervisor when a live session is waiting for permission
  const statePersistence = new DefaultStatePersistence(runsDir);
  const state = loadLatestRunState(
    statePersistence,
    runId as RunId,
    new DefaultJournalReader(getJournalPath(runDir)).readAll(),
  ).state;

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
    if (!sessionRequestId) {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: 'Session has no pending permission request identity.',
        remediation: 'Run `ai status` to review the current pending request.',
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
      result = await ctx.engine.resume({
        ...input,
        sessionId: state.waitingContext.liveSessionId,
        requestId: sessionRequestId,
      });
    } catch (error: unknown) {
      formatter.error(toCLIError(error));
      return ExitCode.RUN_FAILED;
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          ...workflowResultFields(result),
          messageId: sessionRequestId,
          action: granted ? 'granted' : 'denied',
        }) + '\n',
      );
    } else if (!reportWorkflowFailure(result, formatter)) {
      formatter.info(
        `Permission ${granted ? 'grant' : 'denial'} response processed (${sessionRequestId}). State: ${result.finalState}.`,
      );
    }

    return workflowResultFields(result).exitCode;
  }

  // Fallback: non-session runs use the file-backed live request store
  const store = new FileBackedLiveRequestStore(runsDir);
  const granted = !options.deny;
  try {
    const target = options.messageId
      ? undefined
      : (await store.listPendingRequests(runId)).find((request) => request.kind === 'permission');
    const messageId = options.messageId ?? target?.messageId;
    if (!messageId) {
      if (options.json) {
        process.stdout.write(
          JSON.stringify({ runId, outcome: 'no_pending_requests', exitCode: ExitCode.SUCCESS }) +
            '\n',
        );
      } else {
        formatter.info(`No pending permission requests for run ${runId}.`);
      }
      return ExitCode.SUCCESS;
    }
    const outcome = await store.writeResponse(
      { runId, messageId, payload: { granted }, respondedAt: new Date().toISOString() },
      { requireRequest: true },
    );
    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          runId,
          messageId,
          action: granted ? 'granted' : 'denied',
          outcome,
          exitCode: ExitCode.SUCCESS,
        }) + '\n',
      );
    } else {
      const rawDetail: unknown = target?.payload['action'];
      const detail = typeof rawDetail === 'string' ? rawDetail : 'permission request';
      formatter.info(
        outcome === 'already_responded'
          ? `Permission response already recorded (${messageId}).`
          : `Permission ${granted ? 'grant' : 'denial'} response stored for ${detail} (${messageId}).`,
      );
    }
    return ExitCode.SUCCESS;
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.GENERAL_ERROR;
  }
}
