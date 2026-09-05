import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { RunId, RunResult } from '@ai-dev-orchestrator/schemas';

import { resumeOrchestrator } from '../composition-root';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getArtifactsDir, getRunDir, getRunsDir } from '../workspace-paths';

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

  const runsDir = getRunsDir();

  // Route through session supervisor when a live session is waiting for clarification
  const statePersistence = new DefaultStatePersistence(runsDir);
  const state = statePersistence.load(runId as RunId);

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
        data: { kind: 'error', errorCode: 'uncaught_exception', message: msg, recoverable: false },
      });
      process.exitCode = ExitCode.RUN_FAILED;
    };
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);

    let result: RunResult;
    try {
      result = await ctx.engine.resume({ type: 'text', content: answerContent });
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
          runId,
          messageId: sessionRequestId,
          status: 'session_clarification_answered',
          finalState: result.finalState,
        }) + '\n',
      );
    } else {
      formatter.success(
        `Session clarification answered for run ${runId}. State: ${result.finalState}.`,
      );
    }

    return ExitCode.SUCCESS;
  }

  // Fallback: non-session runs use the file-backed live request store
  const liveStore = new FileBackedLiveRequestStore(runsDir);
  const pendingRequests = await liveStore.listPendingRequests(runId);
  const clarificationRequests = pendingRequests.filter((r) => r.kind === 'clarification');

  if (options.messageId) {
    const liveTarget = clarificationRequests.find((r) => r.messageId === options.messageId);
    if (!liveTarget) {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: `No pending clarification request with message ID: ${options.messageId}`,
        remediation: 'Run `ai status` to see pending requests.',
      });
      return ExitCode.GENERAL_ERROR;
    }
    await liveStore.writeResponse({
      runId,
      messageId: liveTarget.messageId,
      payload: { answer: answerContent },
      respondedAt: new Date().toISOString(),
    });

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          runId,
          messageId: liveTarget.messageId,
          status: 'live_clarification_answered',
        }) + '\n',
      );
    } else {
      formatter.success(`Live clarification answered for run ${runId} (${liveTarget.messageId}).`);
    }
    return ExitCode.SUCCESS;
  }

  // Live clarifications require --message-id for deterministic routing.
  // Without it, fall through to the persisted WAITING_FOR_HUMAN path.
  const artifactsDir = getArtifactsDir(runDir);
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  const answersPath = join(artifactsDir, 'clarification_answers_v1.md');
  writeFileSync(answersPath, answerContent, 'utf8');

  formatter.info(`Answering run: ${runId}`);

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
    result = await ctx.engine.resume({ type: 'text', content: answerContent });
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
        runId,
        status: 'answers_received',
        finalState: result.finalState,
        artifactPath: answersPath,
      }) + '\n',
    );
  } else {
    formatter.success(`Answers stored for run ${runId}. State: ${result.finalState}.`);
    formatter.summary({
      'Run ID': result.runId,
      'Final State': result.finalState,
      Artifacts: result.artifactInventory.length,
    });
  }

  return ExitCode.SUCCESS;
}
