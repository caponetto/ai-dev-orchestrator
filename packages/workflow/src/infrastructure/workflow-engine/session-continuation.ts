import type {
  AgentSessionSupervisor,
  JournalWriter,
  SessionAdvanceResult,
  ArtifactStore,
} from '@ai-dev-orchestrator/ports';
import type {
  Action,
  ActionResult,
  AgentSessionHandle,
  ArtifactType,
  HumanInput,
  PersistedWaitingContext,
  RunId,
} from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

type SessionContinuationResult =
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'unreachable'; readonly error?: string }
  | {
      readonly kind: 'advanced';
      readonly handle: AgentSessionHandle;
      readonly advance: SessionAdvanceResult;
    };

interface SessionContinuationContext {
  readonly supervisor: Pick<
    AgentSessionSupervisor,
    'attach' | 'getSnapshot' | 'sendHumanResponse' | 'waitForAdvance'
  >;
  readonly journalWriter: JournalWriter;
  readonly runId: RunId;
  readonly getStateId: () => string;
  readonly isAborted: () => boolean;
}

/** Perform session I/O with cancellation checks; the caller owns all workflow mutations. */
export async function resumeLiveSession(
  savedWaitingContext: PersistedWaitingContext,
  input: HumanInput,
  sessionId: string,
  context: SessionContinuationContext,
): Promise<SessionContinuationResult> {
  const { supervisor, journalWriter, runId, getStateId, isAborted } = context;
  const handle = await supervisor.attach(sessionId);

  if (isAborted()) {
    return { kind: 'interrupted' };
  }

  if (!handle) {
    const snapshot = await supervisor.getSnapshot(sessionId);
    if (isAborted()) {
      return { kind: 'interrupted' };
    }
    if (snapshot && savedWaitingContext.sessionTransport === 'stdio') {
      return {
        kind: 'unreachable',
        error:
          `Local stdio session ${sessionId} cannot be recovered after process restart — ` +
          `child process stdin/stdout handles are severed when the parent exits.`,
      };
    }
    if (snapshot && savedWaitingContext.sessionTransport === 'remote') {
      return {
        kind: 'unreachable',
        error:
          `Remote session ${sessionId} reconnect failed — ` +
          `transport factory unavailable or lease expired.`,
      };
    }
    return { kind: 'unreachable' };
  }

  journalWriter.append({
    timestamp: new Date().toISOString(),
    runId: runId,
    sequence: 0,
    type: 'human_input_received',
    data: {
      kind: 'human',
      action: 'session_resumed',
      stateId: getStateId(),
      sessionId,
    },
  });

  const responsePayload =
    input.type === 'approval'
      ? { granted: true, reason: input.content }
      : input.type === 'rejection'
        ? { granted: false, reason: input.content }
        : { answer: input.content };

  const requestId = savedWaitingContext.pendingRequestId ?? handle.pendingRequests[0]?.requestId;
  if (requestId) {
    await supervisor.sendHumanResponse(sessionId, requestId, responsePayload);
  }

  if (isAborted()) {
    return { kind: 'interrupted' };
  }
  const advance = await supervisor.waitForAdvance(sessionId);

  if (isAborted()) {
    return { kind: 'interrupted' };
  }
  return { kind: 'advanced', handle, advance };
}

export async function createSessionCompletion(
  roleId: AgentSessionHandle['ref']['role'],
  advance: Extract<SessionAdvanceResult, { kind: 'completed' }>,
  outputType: ArtifactType | undefined,
  artifactStore: ArtifactStore,
  runId: RunId,
): Promise<ActionResult> {
  const sessionAction: Action = { type: 'dispatch_worker', params: { role: roleId } };
  let sessionActionResult: ActionResult;
  try {
    if (!outputType) {
      throw new Error(`No output artifact contract configured for session role '${roleId}'`);
    }
    if (!advance.artifactContent) {
      throw new Error(`Session for role '${roleId}' completed without output`);
    }
    const artifactRef = await artifactStore.store({
      type: outputType,
      name: `${roleId}-output`,
      content: advance.artifactContent,
      producedBy: roleId,
      runId: runId,
    });
    sessionActionResult = { action: sessionAction, success: true, artifactRef };
  } catch (error: unknown) {
    sessionActionResult = {
      action: sessionAction,
      success: false,
      error: getErrorMessage(error),
    };
  }
  if (advance.tokenUsage) {
    sessionActionResult = {
      ...sessionActionResult,
      usageSnapshot: {
        totalInputTokens: advance.tokenUsage.inputTokens,
        totalOutputTokens: advance.tokenUsage.outputTokens,
        byRole: {
          [roleId]: { ...advance.tokenUsage, durationMs: advance.durationMs },
        },
      },
    };
  }

  return sessionActionResult;
}

export async function completeSessionAction(
  result: ActionResult,
  sessionId: string,
  completion: ActionResult,
  finalize: (result: ActionResult) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (!result.workerResults) {
    return completion;
  }
  const workerResults = result.workerResults.map((worker) =>
    worker.sessionRef?.sessionId === sessionId
      ? {
          ...worker,
          success: completion.success,
          error: completion.error,
          artifactRef: completion.artifactRef,
          sessionOutcome: 'completed' as const,
          pendingRequest: undefined,
        }
      : worker,
  );
  const pending = workerResults.find((worker) => worker.sessionOutcome === 'awaiting_human');
  return finalize({
    ...result,
    success: workerResults.some((worker) => worker.success),
    workerResults,
    artifactRefs: workerResults.flatMap((worker) =>
      worker.artifactRef ? [worker.artifactRef] : [],
    ),
    sessionOutcome: pending ? 'awaiting_human' : 'completed',
    sessionRef: pending?.sessionRef,
    pendingRequest: pending?.pendingRequest,
  });
}
