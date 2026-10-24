import type { JournalWriter, StatePersistence } from '@ai-dev-orchestrator/ports';
import type { LockHandle, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';

import type { ShutdownState } from './recovery-schemas';

type ShutdownReason = ShutdownState['reason'];

export class ShutdownCoordinator {
  private readonly statePersistence: StatePersistence;
  private readonly journalWriter: JournalWriter;
  private readonly gracefulTimeoutMs: number;
  private readonly schemaVersion: number;
  private shutdownRequested = false;
  private shutdownReason: ShutdownReason = 'signal';
  private shutdownRequestedAt: string | null = null;
  private readonly boundHandler: () => void;
  private readonly shutdownListeners = new Set<() => void>();
  private installed = false;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private onTimeout: (() => void) | undefined;

  constructor(
    statePersistence: StatePersistence,
    journalWriter: JournalWriter,
    gracefulTimeoutMs = 10000,
    schemaVersion = 1,
  ) {
    if (!Number.isFinite(gracefulTimeoutMs) || gracefulTimeoutMs < 0) {
      throw new RangeError('Graceful shutdown timeout must be a finite non-negative number');
    }
    this.statePersistence = statePersistence;
    this.journalWriter = journalWriter;
    this.gracefulTimeoutMs = gracefulTimeoutMs;
    this.schemaVersion = schemaVersion;
    this.boundHandler = () => {
      this.requestShutdown('signal');
    };
  }

  install(onTimeout?: () => void): void {
    if (this.installed) {
      return;
    }
    this.installed = true;
    this.onTimeout = onTimeout;
    process.on('SIGTERM', this.boundHandler);
    process.on('SIGINT', this.boundHandler);
    this.armDeadline();
  }

  uninstall(): void {
    this.installed = false;
    this.onTimeout = undefined;
    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    process.removeListener('SIGTERM', this.boundHandler);
    process.removeListener('SIGINT', this.boundHandler);
  }

  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  onShutdown(listener: () => void): () => void {
    if (this.shutdownRequested) {
      this.notify(listener);
      return () => {};
    }
    this.shutdownListeners.add(listener);
    return () => {
      this.shutdownListeners.delete(listener);
    };
  }

  requestShutdown(reason: ShutdownReason): void {
    if (this.shutdownRequested) {
      return;
    }
    this.shutdownRequested = true;
    this.shutdownReason = reason;
    this.shutdownRequestedAt = new Date().toISOString();
    this.armDeadline();
    for (const listener of [...this.shutdownListeners]) {
      this.notify(listener);
    }
    this.shutdownListeners.clear();
  }

  private notify(listener: () => void): void {
    try {
      listener();
    } catch {
      /* Other shutdown work must still run. */
    }
  }

  private armDeadline(): void {
    if (
      !this.installed ||
      !this.shutdownRequested ||
      !this.onTimeout ||
      this.deadlineTimer !== null
    ) {
      return;
    }
    const elapsed = Date.now() - Date.parse(this.getShutdownState().requestedAt);
    this.deadlineTimer = setTimeout(
      () => {
        this.deadlineTimer = null;
        const onTimeout = this.onTimeout;
        if (onTimeout) {
          this.notify(onTimeout);
        }
      },
      Math.max(0, this.gracefulTimeoutMs - elapsed),
    );
  }

  getShutdownReason(): ShutdownReason {
    return this.shutdownReason;
  }

  getShutdownState(): ShutdownState {
    return {
      requested: this.shutdownRequested,
      reason: this.shutdownReason,
      requestedAt: this.shutdownRequestedAt ?? '',
    };
  }

  getGracefulTimeoutMs(): number {
    return this.gracefulTimeoutMs;
  }

  async initiateShutdown(
    runId: RunId,
    lockHandle: LockHandle,
    currentState: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    const state: PersistedState = {
      runId,
      schemaVersion: this.schemaVersion,
      currentState,
      previousState: null,
      stateEnteredAt: now,
      transitionCount: 0,
      stateHistory: [currentState],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: now,
      persistenceVersion: 1,
      checksum: '',
    };

    await this.statePersistence.save(state);

    this.journalWriter.append({
      timestamp: now,
      runId,
      sequence: 0,
      type: 'run_aborted',
      data: {
        kind: 'run_lifecycle',
        workflowName: 'default',
        workflowVersion: '1.0.0',
        reason: `shutdown:${this.shutdownReason}`,
        status: 'paused',
      },
    });

    this.statePersistence.releaseLock(lockHandle);
  }
}
