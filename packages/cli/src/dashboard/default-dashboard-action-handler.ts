import { existsSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { projectWorkflowPreview } from '@ai-dev-orchestrator/dashboard-server';
import type {
  AgentStreamBus,
  AgentStreamEvent,
  AgentSessionSupervisor,
  CreateRunResult,
  DashboardActionHandler,
} from '@ai-dev-orchestrator/ports';
import { RUN_LOCK_FILENAME } from '@ai-dev-orchestrator/schemas';
import type {
  DashboardActionResult,
  RunCreationParams,
  RunId,
  WorkflowStateView,
  WorkflowSummary,
} from '@ai-dev-orchestrator/schemas';

import { TERMINAL_STATES, abortRunState } from '../abort-run';
import type { AbortRunResult } from '../abort-run';
import { loadAllWorkflows, loadWorkflowByName, preflightSelectedModels } from '../composition-root';
import { readLockMetadata, recoverRunState, terminateRunFromLock } from '../run-state-recovery';
import { getRunsDir, getStatePath } from '../workspace-paths';

import { spawnDetachedCli } from './detached-cli-launch';
import { runCreationParamsToCliArgs } from './run-creation-args';

export class DefaultDashboardActionHandler implements DashboardActionHandler {
  private readonly sessionSupervisor?: AgentSessionSupervisor;
  private readonly streamBus?: AgentStreamBus;
  private readonly launches = new Map<
    string,
    { key: string; result: Promise<DashboardActionResult> }
  >();

  constructor(sessionSupervisor?: AgentSessionSupervisor, streamBus?: AgentStreamBus) {
    this.sessionSupervisor = sessionSupervisor;
    this.streamBus = streamBus;
  }

  async approve(
    runId: string,
    options: { message?: string; sessionId?: string },
  ): Promise<DashboardActionResult> {
    return this.resumeWith(
      runId,
      'approval',
      options.message ?? 'Approved via dashboard',
      options.sessionId,
    );
  }

  async reject(
    runId: string,
    options: { message?: string; sessionId?: string },
  ): Promise<DashboardActionResult> {
    return this.resumeWith(
      runId,
      'rejection',
      options.message ?? 'Rejected via dashboard',
      options.sessionId,
    );
  }

  async answer(
    runId: string,
    options: { content: string; sessionId?: string },
  ): Promise<DashboardActionResult> {
    if (!options.content.trim()) {
      return { success: false, error: 'Answer content must be non-empty' };
    }
    return this.resumeWith(runId, 'text', options.content, options.sessionId);
  }

  async abort(
    runId: string,
    options: { force?: boolean; sessionId?: string; reason?: string },
  ): Promise<DashboardActionResult> {
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    if (!existsSync(runDir)) {
      return { success: false, error: `Run directory not found: ${runId}` };
    }

    const statePersistence = new DefaultStatePersistence(runsDir);
    const recovered = recoverRunState(runsDir, runId);
    const state = recovered.state;
    if (!state) {
      return {
        success: false,
        error: `No state found for run: ${runId}. The run has no checkpoint, journal, or lock file to reconstruct from.`,
      };
    }

    if (recovered.source === 'lock' && !options.force) {
      return {
        success: false,
        error: `Run ${runId} has not checkpointed yet. Retry with force to terminate the live process from run.lock.`,
      };
    }

    if (TERMINAL_STATES.has(state.currentState) && !state.pendingTerminalState) {
      return { success: true, outcome: 'already_terminal', finalState: state.currentState };
    }

    // v1: session abort = run abort (single session per wait).
    // Validate sessionId to prevent stale UI targeting the wrong session.
    if (options.sessionId) {
      const liveSessionId = state.waitingContext?.liveSessionId;
      if (liveSessionId && liveSessionId !== options.sessionId) {
        return {
          success: false,
          error: `Session ID mismatch: expected ${liveSessionId}, got ${options.sessionId}`,
        };
      }
    }

    const lockPath = join(runDir, RUN_LOCK_FILENAME);
    const lock = recovered.lock ?? readLockMetadata(lockPath);
    if (lock?.pid && lock.pid !== process.pid) {
      terminateRunFromLock(lock);
    }

    const abortReason = options.reason ?? 'Aborted via dashboard';

    let result: AbortRunResult;
    try {
      result = await abortRunState(statePersistence, runsDir, runId, state, abortReason, {
        expectedSessionId: options.sessionId,
        onOwned: async (latest) => {
          const liveSessionId = latest.waitingContext?.liveSessionId;
          if (liveSessionId && this.sessionSupervisor) {
            try {
              await this.sessionSupervisor.abort(liveSessionId, abortReason);
            } catch {
              // Session cancellation is best-effort after run ownership and identity validation.
            }
          }
        },
      });
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.outcome === 'aborted') {
      this.publishStatus({
        runId,
        stateId: result.finalState,
        roleId: 'human',
        dispatchId: `human-${String(Date.now())}`,
        timestamp: new Date().toISOString(),
        type: 'status',
        content: abortReason,
        structuredData: {
          action: 'aborted',
          reason: abortReason,
          previousState: result.previousState,
          finalState: result.finalState,
        },
      });
    }
    return { success: true, outcome: result.outcome, finalState: result.finalState };
  }

  async retry(runId: string): Promise<DashboardActionResult> {
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    if (!existsSync(runDir)) {
      return { success: false, error: `Run directory not found: ${runId}` };
    }

    const statePersistence = new DefaultStatePersistence(runsDir);
    const recovered = recoverRunState(runsDir, runId);
    const state = recovered.state;
    if (!state) {
      return {
        success: false,
        error: `No state found for run: ${runId}`,
      };
    }

    if (state.currentState === 'DONE' && !state.pendingTerminalState) {
      return { success: false, error: `Run ${runId} has already completed successfully` };
    }

    if (
      !TERMINAL_STATES.has(state.currentState) &&
      state.currentState !== 'FAILED' &&
      !state.pendingTerminalState
    ) {
      return {
        success: false,
        error: `Run ${runId} is not in a terminal state (current: ${state.currentState})`,
      };
    }

    const retryState = state.pendingTerminalState ? state.currentState : state.previousState;
    if (!retryState) {
      return {
        success: false,
        error: `Run ${runId} has no previous state to retry from`,
      };
    }

    if (
      (TERMINAL_STATES.has(retryState) || retryState === 'FAILED') &&
      !state.pendingTerminalState
    ) {
      return {
        success: false,
        error: `Cannot retry from terminal state '${retryState}'`,
      };
    }

    const lock = statePersistence.probeLock(runId as RunId);
    if (lock.exists && (lock.pidRunning || lock.unreadable || lock.hostname !== hostname())) {
      return {
        success: false,
        error: `Run ${runId} is active or its lock owner cannot be verified`,
      };
    }

    const args = ['retry', runId];
    if (state.repoRoot) {
      args.push('--repo', state.repoRoot);
    }
    return this.launchControl(runId, 'retry', state.repoRoot ?? process.cwd(), args, () => ({
      runId,
      stateId: state.currentState,
      roleId: 'human',
      dispatchId: `human-${String(Date.now())}`,
      timestamp: new Date().toISOString(),
      type: 'status',
      content: `Retry requested from ${retryState.replaceAll('_', ' ').toLowerCase()}`,
      structuredData: { action: 'retry_requested', outcome: 'started', fromState: retryState },
    }));
  }

  async deleteRun(runId: string): Promise<DashboardActionResult> {
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    if (!existsSync(runDir)) {
      return { success: false, error: `Run directory not found: ${runId}` };
    }

    await this.ensureLockReleased(runId);

    try {
      rmSync(runDir, { recursive: true, force: true });
      return { success: true };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  getWorkflowPreview(name: string): WorkflowStateView | null {
    const workflow = loadWorkflowByName(name);
    if (!workflow) {
      return null;
    }
    return projectWorkflowPreview(workflow);
  }

  listWorkflows(): WorkflowSummary[] {
    const workflows = loadAllWorkflows();
    return workflows.map((w) => ({
      name: w.name,
      version: w.version,
      stateCount: Object.keys(w.states).length,
    }));
  }

  async createRun(options: RunCreationParams): Promise<CreateRunResult> {
    const prompt = options.prompt.trim();
    if (!prompt) {
      return { success: false, error: 'Prompt must be non-empty' };
    }

    const repoRoot = options.repoRoot;

    try {
      const preflight = await preflightSelectedModels(repoRoot ?? tmpdir());
      const args = runCreationParamsToCliArgs({ ...options, prompt });
      await spawnDetachedCli(repoRoot ?? tmpdir(), args, undefined, preflight.receipt);

      return { success: true, runId: '', outcome: 'started' };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async ensureLockReleased(runId: string): Promise<void> {
    const runsDir = getRunsDir();
    const statePersistence = new DefaultStatePersistence(runsDir);
    const probe = statePersistence.probeLock(runId as RunId);
    if (!probe.exists || !probe.pidRunning) {
      return;
    }

    const lockPath = join(runsDir, runId, RUN_LOCK_FILENAME);
    const lock = readLockMetadata(lockPath);
    terminateRunFromLock(lock);

    const MAX_RETRIES = 20;
    const INTERVAL_MS = 300;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const recheck = statePersistence.probeLock(runId as RunId);
      if (!recheck.exists || !recheck.pidRunning) {
        return;
      }
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  private async resumeWith(
    runId: string,
    type: 'approval' | 'rejection' | 'text',
    content: string,
    sessionId?: string,
  ): Promise<DashboardActionResult> {
    try {
      const runsDir = getRunsDir();
      const runDir = join(runsDir, runId);
      if (!existsSync(runDir)) {
        return { success: false, error: `Run directory not found: ${runId}` };
      }

      if (!existsSync(getStatePath(runDir))) {
        return { success: false, error: `No state found for run: ${runId}` };
      }

      if (sessionId) {
        const statePersistence = new DefaultStatePersistence(runsDir);
        const state = statePersistence.load(runId as RunId);
        const liveSessionId = state?.waitingContext?.liveSessionId;
        if (liveSessionId && liveSessionId !== sessionId) {
          return {
            success: false,
            error: `Session ID mismatch: expected ${liveSessionId}, got ${sessionId}`,
          };
        }
      }

      await this.ensureLockReleased(runId);

      const statePersistence = new DefaultStatePersistence(runsDir);
      const state = statePersistence.load(runId as RunId);
      if (
        state &&
        !state.pendingTerminalState &&
        (TERMINAL_STATES.has(state.currentState) || state.currentState === 'FAILED')
      ) {
        return {
          success: false,
          error: `Run ${runId} is already in terminal state: ${state.currentState}`,
        };
      }
      if (sessionId && state?.waitingContext?.liveSessionId !== sessionId) {
        return {
          success: false,
          error: `Session ID mismatch: expected ${state?.waitingContext?.liveSessionId ?? 'no live session'}, got ${sessionId}`,
        };
      }
      const reqState = state?.waitingContext?.requestingState.replaceAll('_', ' ').toLowerCase();
      const args =
        type === 'text'
          ? ['answer', runId, content]
          : ['approve', runId, ...(type === 'rejection' ? ['--reject'] : []), '--message', content];
      return await this.launchControl(
        runId,
        JSON.stringify([type, content, sessionId]),
        process.cwd(),
        args,
        () => ({
          runId,
          stateId: state?.currentState ?? 'WAITING_FOR_HUMAN',
          roleId: 'human',
          dispatchId: `human-${String(Date.now())}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content:
            type === 'text'
              ? `Answer requested: ${content}`
              : `${type === 'approval' ? 'Approval' : 'Rejection'} requested${reqState ? ` for ${reqState}` : ''}`,
          structuredData: { action: `${type}_requested`, outcome: 'started', message: content },
        }),
      );
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private publishStatus(event: AgentStreamEvent): void {
    try {
      this.streamBus?.publish(event);
    } catch {
      // Best-effort notification cannot undo a committed abort or acknowledged launch.
    }
  }

  private async launchControl(
    runId: string,
    key: string,
    baseDir: string,
    args: string[],
    event: () => AgentStreamEvent,
  ): Promise<DashboardActionResult> {
    const pending = this.launches.get(runId);
    if (pending) {
      return pending.key === key
        ? pending.result
        : { success: false, error: `Another control request is already starting for run ${runId}` };
    }
    const result = (async (): Promise<DashboardActionResult> => {
      try {
        await spawnDetachedCli(baseDir, args, join(getRunsDir(), runId, 'cli-stderr.log'));
        this.publishStatus(event());
        return { success: true, outcome: 'started' };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.publishStatus({
          runId,
          stateId: event().stateId,
          roleId: 'orchestrator',
          dispatchId: `error-${String(Date.now())}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content: `Control request failed: ${message}`,
          structuredData: { action: 'request_failed', error: message },
        });
        return { success: false, error: message };
      }
    })();
    this.launches.set(runId, { key, result });
    try {
      return await result;
    } finally {
      this.launches.delete(runId);
    }
  }
}
