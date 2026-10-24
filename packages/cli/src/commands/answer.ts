import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { RunId, RunResult } from '@ai-dev-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { reportWorkflowFailure, workflowResultFields } from '../output/workflow-result';
import { loadLatestRunState } from '../run-state-recovery';
import { getArtifactsDir, getJournalPath, getRunDir, getRunsDir } from '../workspace-paths';

import { findLatestRunWithState } from './find-run';

export interface AnswerOptions {
  readonly runId: string | null;
  readonly inputFile: string | null;
  readonly messageId: string | null;
  readonly answers: readonly string[];
  readonly json: boolean;
  readonly verbose: boolean;
}

export async function answerCommand(
  options: AnswerOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestRunWithState();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No active run found.',
      remediation: 'Specify a run ID: ai answer <runId>',
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

  let answerContent: string;
  if (options.inputFile) {
    try {
      answerContent = readFileSync(options.inputFile, 'utf8');
    } catch (error: unknown) {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: `Cannot read input file: ${options.inputFile}`,
        remediation: 'Check the file path and permissions.',
        detail: error instanceof Error ? error.message : undefined,
      });
      return ExitCode.GENERAL_ERROR;
    }
  } else if (options.answers.length > 0) {
    answerContent = options.answers.join('\n');
  } else {
    formatter.error({
      code: ExitCode.INVALID_ARGUMENTS,
      message: 'No answers provided.',
      remediation: 'Provide answers as positional arguments or via --input-file.',
    });
    return ExitCode.INVALID_ARGUMENTS;
  }

  if (!answerContent.trim()) {
    formatter.error({
      code: ExitCode.INVALID_ARGUMENTS,
      message: 'Answer content must be non-empty.',
      remediation: 'Provide a non-empty answer or input file.',
    });
    return ExitCode.INVALID_ARGUMENTS;
  }

  const runsDir = getRunsDir();

  // Route through session supervisor when a live session is waiting for clarification
  const statePersistence = new DefaultStatePersistence(runsDir);
  const state = loadLatestRunState(
    statePersistence,
    runId as RunId,
    new DefaultJournalReader(getJournalPath(runDir)).readAll(),
  ).state;

  if (
    state?.waitingContext?.liveSessionId &&
    state.waitingContext.liveRequestType === 'clarification'
  ) {
    const sessionRequestId = state.waitingContext.pendingRequestId;

    if (options.messageId && options.messageId !== sessionRequestId) {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: `No pending clarification request with message ID: ${options.messageId}`,
        remediation: sessionRequestId
          ? `Session has pending request: ${sessionRequestId}`
          : 'Run `ai status` to see pending requests.',
      });
      return ExitCode.GENERAL_ERROR;
    }

    formatter.info(`Delivering answer to session ${state.waitingContext.liveSessionId}.`);

    let ctx;
    try {
      ctx = await resumeOrchestrator(process.cwd(), runId);
    } catch (error: unknown) {
      formatter.error(toCLIError(error));
      return ExitCode.CONFIGURATION_ERROR;
    }

    try {
      for (const w of ctx.warnings) {
        formatter.warn(w);
      }

      const onUncaught = (err: unknown): void => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId,
          sequence: 0,
          type: 'error',
          data: {
            kind: 'error',
            errorCode: 'uncaught_exception',
            message: msg,
            recoverable: false,
          },
        });
        process.exitCode = ExitCode.RUN_FAILED;
      };
      process.on('uncaughtException', onUncaught);
      process.on('unhandledRejection', onUncaught);

      let result: RunResult;
      try {
        result = await ctx.engine.resume({
          type: 'text',
          content: answerContent,
          sessionId: state.waitingContext.liveSessionId,
          requestId: sessionRequestId,
        });
      } catch (error: unknown) {
        formatter.error(toCLIError(error));
        return ExitCode.RUN_FAILED;
      } finally {
        process.removeListener('uncaughtException', onUncaught);
        process.removeListener('unhandledRejection', onUncaught);
      }

      if (options.json) {
        process.stdout.write(
          JSON.stringify({
            ...workflowResultFields(result),
            messageId: sessionRequestId,
            status: 'session_clarification_answered',
          }) + '\n',
        );
      } else if (!reportWorkflowFailure(result, formatter)) {
        formatter.info(
          `Session clarification answered for run ${runId}. State: ${result.finalState}.`,
        );
      }

      return workflowResultFields(result).exitCode;
    } finally {
      ctx.shutdownCoordinator?.uninstall();
    }
  }

  // Fallback: non-session runs use the file-backed live request store
  const liveStore = new FileBackedLiveRequestStore(runsDir);
  if (options.messageId) {
    let outcome: 'response_written' | 'already_responded';
    try {
      outcome = await liveStore.writeResponse(
        {
          runId,
          messageId: options.messageId,
          payload: { answer: answerContent },
          respondedAt: new Date().toISOString(),
        },
        { requireRequest: true },
      );
    } catch (error: unknown) {
      formatter.error(toCLIError(error));
      return ExitCode.GENERAL_ERROR;
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          runId,
          messageId: options.messageId,
          status: 'live_clarification_answered',
          outcome,
          exitCode: ExitCode.SUCCESS,
        }) + '\n',
      );
    } else {
      formatter.success(
        outcome === 'already_responded'
          ? `Live clarification response already recorded for run ${runId} (${options.messageId}).`
          : `Live clarification response stored for run ${runId} (${options.messageId}).`,
      );
    }
    return ExitCode.SUCCESS;
  }

  // Live clarifications require --message-id for deterministic routing.
  // Without it, fall through to the persisted WAITING_FOR_HUMAN path.
  const artifactsDir = getArtifactsDir(runDir);
  const answersPath = join(artifactsDir, 'clarification_answers_v1.md');

  formatter.info(`Answering run: ${runId}`);

  let ctx;
  try {
    ctx = await resumeOrchestrator(process.cwd(), runId);
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  try {
    for (const w of ctx.warnings) {
      formatter.warn(w);
    }

    const wait = state?.waitingContext ?? state?.entryActionContinuation?.resumeWaitingContext;
    if (!state || !wait || wait.requiredInput !== 'text' || wait.liveSessionId) {
      formatter.error({
        code: ExitCode.INVALID_ARGUMENTS,
        message: 'This run has no persisted text wait to answer.',
        remediation: 'Inspect the current run state and pending requests before responding.',
      });
      return ExitCode.INVALID_ARGUMENTS;
    }
    const accepted = state.entryActionContinuation?.resumeInput;
    if (accepted?.type === 'text' && accepted.content !== answerContent) {
      formatter.error({
        code: ExitCode.INVALID_ARGUMENTS,
        message: 'An answer is already accepted for this wait.',
        remediation: 'Use `ai resume` to recover the accepted answer instead of replacing it.',
      });
      return ExitCode.INVALID_ARGUMENTS;
    }

    const onUncaughtFb = (err: unknown): void => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: 0,
        type: 'error',
        data: { kind: 'error', errorCode: 'uncaught_exception', message: msg, recoverable: false },
      });
      process.exitCode = ExitCode.RUN_FAILED;
    };
    process.on('uncaughtException', onUncaughtFb);
    process.on('unhandledRejection', onUncaughtFb);

    let result: RunResult;
    try {
      result = await ctx.engine.resume({
        type: 'text',
        content: answerContent,
        waitIdentity: {
          stateId: state.currentState,
          requestingState: wait.requestingState,
          waitingSince: wait.waitingSince,
        },
      });
    } catch (error: unknown) {
      formatter.error(toCLIError(error));
      return ExitCode.RUN_FAILED;
    } finally {
      process.removeListener('uncaughtException', onUncaughtFb);
      process.removeListener('unhandledRejection', onUncaughtFb);
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          ...workflowResultFields(result),
          status: 'answers_received',
          accepted: result.answerAccepted === true,
          ...(result.answerAccepted ? { artifactPath: answersPath } : {}),
        }) + '\n',
      );
    } else if (!reportWorkflowFailure(result, formatter)) {
      formatter.info(
        result.answerAccepted
          ? `Answers stored for run ${runId}. State: ${result.finalState}.`
          : `Answer not accepted for run ${runId}. State: ${result.finalState}.`,
      );
      formatter.summary({
        'Run ID': result.runId,
        'Final State': result.finalState,
        Artifacts: result.artifactInventory.length,
      });
    }

    return workflowResultFields(result).exitCode;
  } finally {
    ctx.shutdownCoordinator?.uninstall();
  }
}
