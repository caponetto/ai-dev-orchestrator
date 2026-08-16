import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { projectWorkflowPreview } from '@ai-orchestrator/dashboard-server';
import { DefaultJournalWriter } from '@ai-orchestrator/journal';
import type {
  AgentStreamBus,
  AgentSessionSupervisor,
  CreateRunResult,
  DashboardActionHandler,
} from '@ai-orchestrator/ports';
import { RUN_LOCK_FILENAME } from '@ai-orchestrator/schemas';
import type {
  DashboardActionResult,
  RunCreationParams,
  RunId,
  WorkflowStateView,
  WorkflowSummary,
} from '@ai-orchestrator/schemas';

import { TERMINAL_STATES, buildAbortedState, writeAbortJournalEntries } from '../abort-run';
import { loadAllWorkflows, loadWorkflowByName } from '../composition-root';
import { readLockMetadata, recoverRunState, terminateRunFromLock } from '../run-state-recovery';
import { getJournalPath, getRunsDir, getStatePath } from '../workspace-paths';

import { runCreationParamsToCliArgs } from './run-creation-args';

function getCliEntryPath(): string {
  return process.argv[1];
}

function spawnDetachedCli(baseDir: string, args: string[]): void {
  const entry = getCliEntryPath();
  const cwd = existsSync(baseDir) ? baseDir : tmpdir();
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
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

    const lockPath = join(runDir, RUN_LOCK_FILENAME);
    const lock = recovered.lock ?? readLockMetadata(lockPath);
    if (lock?.pid && lock.pid !== process.pid) {
      terminateRunFromLock(lock);
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
      await statePersistence.save(buildAbortedState(state));
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    try {
      writeAbortJournalEntries(runsDir, runId, state, abortReason);
    } catch {
      // Journal write failure is non-fatal for abort
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

    if (!TERMINAL_STATES.has(state.currentState) && state.currentState !== 'FAILED') {
      return {
        success: false,
        error: `Run ${runId} is not in a terminal state (current: ${state.currentState})`,
      };
    }

    const retryState = state.previousState;
    if (!retryState) {
      return {
        success: false,
        error: `Run ${runId} has no previous state to retry from`,
      };
    }

    if (TERMINAL_STATES.has(retryState) || retryState === 'FAILED') {
      return {
        success: false,
        error: `Cannot retry from terminal state '${retryState}'`,
      };
    }

    await this.ensureLockReleased(runId);

    const retriedState = {
      ...state,
      currentState: retryState,
      previousState: state.previousState,
      stateEnteredAt: new Date().toISOString(),
      waitingContext: undefined,
      persistedAt: new Date().toISOString(),
    };

    try {
      await statePersistence.save(retriedState);
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }

    const journalPath = getJournalPath(runDir);
    try {
      const journalWriter = new DefaultJournalWriter(journalPath, runId);
      journalWriter.append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: state.transitionCount + 1,
        type: 'run_resumed',
        data: {
          kind: 'run_lifecycle',
          workflowName: state.workflowName,
          workflowVersion: state.workflowVersion,
          status: 'retrying',
          reason: `Retrying from state '${retryState}'`,
        },
      });
    } catch {
      // Journal write failure is non-fatal for retry
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
      spawnDetachedCli(state.repoRoot ?? process.cwd(), args);
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

  createRun(options: RunCreationParams): Promise<CreateRunResult> {
    const prompt = options.prompt.trim();
    if (!prompt) {
      return Promise.resolve({ success: false, error: 'Prompt must be non-empty' });
    }

    const repoRoot = options.repoRoot;

    try {
      const args = runCreationParamsToCliArgs({ ...options, prompt });
      spawnDetachedCli(repoRoot ?? tmpdir(), args);

      return Promise.resolve({ success: true, runId: '' });
    } catch (e: unknown) {
      return Promise.resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
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

      if (type === 'approval') {
        spawnDetachedCli(process.cwd(), ['approve', runId, '--message', content]);
      } else if (type === 'rejection') {
        spawnDetachedCli(process.cwd(), ['approve', runId, '--reject', '--message', content]);
      } else {
        spawnDetachedCli(process.cwd(), ['answer', runId, content]);
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
