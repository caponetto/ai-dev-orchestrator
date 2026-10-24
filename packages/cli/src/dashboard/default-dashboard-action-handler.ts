import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { projectWorkflowPreview } from '@ai-dev-orchestrator/dashboard-server';
import type {
  AgentStreamBus,
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
import { loadAllWorkflows, loadWorkflowByName, preflightSelectedModels } from '../composition-root';
import { readLockMetadata, recoverRunState, terminateRunFromLock } from '../run-state-recovery';
import { getRunsDir, getStatePath } from '../workspace-paths';

import { runCreationParamsToCliArgs } from './run-creation-args';

function getCliEntryPath(): string {
  return process.argv[1];
}

function spawnDetachedCli(
  baseDir: string,
  args: string[],
  logPath?: string,
  modelPreflightReceipt?: string,
): void {
  const entry = getCliEntryPath();
  const cwd = existsSync(baseDir) ? baseDir : tmpdir();
  let stderrFd: number | undefined;
  if (logPath) {
    stderrFd = openSync(logPath, 'a');
  }
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    detached: true,
    stdio: ['ignore', 'ignore', stderrFd ?? 'ignore'],
    ...(modelPreflightReceipt
      ? { env: { ...process.env, AI_ORCHESTRATOR_MODEL_PREFLIGHT: modelPreflightReceipt } }
      : {}),
  });
  child.unref();
  if (stderrFd !== undefined) {
    closeSync(stderrFd);
  }
}

export class DefaultDashboardActionHandler implements DashboardActionHandler {
  private readonly sessionSupervisor?: AgentSessionSupervisor;
  private readonly streamBus?: AgentStreamBus;

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

    if (TERMINAL_STATES.has(state.currentState)) {
      return { success: true };
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

    const liveSessionId = options.sessionId ?? state.waitingContext?.liveSessionId;
    if (liveSessionId && this.sessionSupervisor) {
      try {
        await this.sessionSupervisor.abort(
          liveSessionId,
          options.reason ?? 'Aborted via dashboard',
        );
      } catch {
        // Session abort is best-effort — the session may already be dead
      }
    }

    const abortReason = options.reason ?? 'Aborted via dashboard';

    try {
      await abortRunState(statePersistence, runsDir, runId, state, abortReason);
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (this.streamBus) {
      this.streamBus.publish({
        runId,
        stateId: state.currentState,
        roleId: 'human',
        dispatchId: `human-${String(Date.now())}`,
        timestamp: new Date().toISOString(),
        type: 'status',
        content: abortReason,
        structuredData: { action: 'aborted', reason: abortReason },
      });
    }

    return { success: true };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Keep the async handler contract; validation and spawning are synchronous.
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

    if (this.streamBus) {
      this.streamBus.publish({
        runId,
        stateId: retryState,
        roleId: 'human',
        dispatchId: `human-${String(Date.now())}`,
        timestamp: new Date().toISOString(),
        type: 'status',
        content: `Retrying from ${retryState.replaceAll('_', ' ').toLowerCase()}`,
        structuredData: { action: 'retrying', fromState: retryState },
      });
    }

    try {
      const args = ['retry', runId];
      if (state.repoRoot) {
        args.push('--repo', state.repoRoot);
      }
      const logFile = join(runDir, 'cli-stderr.log');
      spawnDetachedCli(state.repoRoot ?? process.cwd(), args, logFile);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
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
      spawnDetachedCli(repoRoot ?? tmpdir(), args, undefined, preflight.receipt);

      return { success: true, runId: '' };
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

    try {
      if (this.streamBus) {
        const statePersistence = new DefaultStatePersistence(runsDir);
        const state = statePersistence.load(runId as RunId);
        const stateId = state?.currentState ?? 'WAITING_FOR_HUMAN';
        const actionMap = {
          approval: 'approved',
          rejection: 'rejected',
          text: 'answered',
        } as const;
        const reqState = state?.waitingContext?.requestingState.replaceAll('_', ' ').toLowerCase();
        const contentMap = {
          approval: reqState ? `Approved ${reqState}` : 'Approved',
          rejection: reqState ? `Rejected ${reqState}` : 'Rejected',
          text: content,
        };
        this.streamBus.publish({
          runId,
          stateId,
          roleId: 'human',
          dispatchId: `human-${String(Date.now())}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content: contentMap[type],
          structuredData: {
            messageType: type === 'text' ? 'clarification_response' : 'permission_response',
            granted: type !== 'rejection',
            action: actionMap[type],
            message: content,
          },
        });
      }

      const logFile = join(runDir, 'cli-stderr.log');
      if (type === 'approval') {
        spawnDetachedCli(process.cwd(), ['approve', runId, '--message', content], logFile);
      } else if (type === 'rejection') {
        spawnDetachedCli(
          process.cwd(),
          ['approve', runId, '--reject', '--message', content],
          logFile,
        );
      } else {
        spawnDetachedCli(process.cwd(), ['answer', runId, content], logFile);
      }

      return { success: true };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      if (this.streamBus) {
        this.streamBus.publish({
          runId,
          stateId: 'WAITING_FOR_HUMAN',
          roleId: 'orchestrator',
          dispatchId: `error-${String(Date.now())}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content: `Resume failed: ${errorMessage}`,
          structuredData: { action: 'error', error: errorMessage },
        });
      }

      return { success: false, error: errorMessage };
    }
  }
}
