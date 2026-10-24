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
  AgentSessionRef,
  ArtifactType,
  ArtifactRef,
  HumanInput,
  PersistedWaitingContext,
  RunId,
  SessionPendingRequest,
} from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

type SessionContinuationResult =
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'unreachable'; readonly error?: string }
  | {
      readonly kind: 'advanced';
      readonly handle: AgentSessionHandle;
      readonly advance: SessionAdvanceResult;
      readonly requestChanged?: true;
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
  readonly expectedRef?: AgentSessionRef;
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

  if (
    handle.ref.runId !== runId ||
    handle.ref.sessionId !== sessionId ||
    handle.ref.stateId !== (context.expectedRef?.stateId ?? savedWaitingContext.requestingState) ||
    (context.expectedRef !== undefined && handle.ref.role !== context.expectedRef.role)
  ) {
    throw new Error('Attached session identity does not match the waiting workflow');
  }

  const terminated =
    handle.state === 'completed' || handle.state === 'failed' || handle.state === 'aborted';
  const recordedRequest = savedWaitingContext.pendingRequestId;
  if (
    !terminated &&
    recordedRequest &&
    handle.pendingRequests.length > 0 &&
    !handle.pendingRequests.some((request) => request.requestId === recordedRequest)
  ) {
    return {
      kind: 'advanced',
      handle,
      requestChanged: true,
      advance: { kind: 'awaiting_human', pendingRequest: handle.pendingRequests[0] },
    };
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
  if (
    requestId &&
    !terminated &&
    (handle.state === 'awaiting_human' || handle.pendingRequests.length > 0)
  ) {
    const delivered = await supervisor.sendHumanResponse(sessionId, requestId, responsePayload);
    if (!delivered) {
      throw new Error(`Human response for request '${requestId}' was not delivered`);
    }
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
  sessionId?: string,
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
    let artifactRef: ArtifactRef | undefined;
    if (sessionId) {
      const refs = await artifactStore.list({ type: outputType, name: `${roleId}-output` });
      for (const ref of refs) {
        const artifact = await artifactStore.get(ref);
        if (
          artifact.metadata?.['completionSessionId'] !== sessionId ||
          artifact.metadata['completionRunId'] !== runId
        ) {
          continue;
        }
        if (
          artifact.content !== advance.artifactContent ||
          !(await artifactStore.verify(ref)).valid
        ) {
          throw new Error(
            `Stored completion for session '${sessionId}' is inconsistent or corrupt`,
          );
        }
        artifactRef = ref;
        break;
      }
    }
    artifactRef ??= await artifactStore.store({
      type: outputType,
      name: `${roleId}-output`,
      content: advance.artifactContent,
      producedBy: roleId,
      runId: runId,
      metadata: sessionId ? { completionSessionId: sessionId, completionRunId: runId } : undefined,
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

/** Refresh only the session that advanced, preserving other workers and completed output. */
export function refreshSessionRequest(
  result: ActionResult,
  sessionId: string,
  pendingRequest: SessionPendingRequest,
): ActionResult {
  return {
    ...result,
    ...(result.sessionRef?.sessionId === sessionId ? { pendingRequest } : {}),
    ...(result.workerResults
      ? {
          workerResults: result.workerResults.map((worker) =>
            worker.sessionRef?.sessionId === sessionId ? { ...worker, pendingRequest } : worker,
          ),
        }
      : {}),
  };
}
