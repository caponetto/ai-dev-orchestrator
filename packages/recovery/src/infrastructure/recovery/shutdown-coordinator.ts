import type { JournalWriter, StatePersistence } from '@ai-orchestrator/ports';
import type { LockHandle, PersistedState, RunId } from '@ai-orchestrator/schemas';

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

  constructor(
    statePersistence: StatePersistence,
    journalWriter: JournalWriter,
    gracefulTimeoutMs = 10000,
    schemaVersion = 1,
  ) {
    this.statePersistence = statePersistence;
    this.journalWriter = journalWriter;
    this.gracefulTimeoutMs = gracefulTimeoutMs;
    this.schemaVersion = schemaVersion;
    this.boundHandler = () => {
      this.requestShutdown('signal');
    };
  }

  install(): void {
    process.on('SIGTERM', this.boundHandler);
    process.on('SIGINT', this.boundHandler);
  }

  uninstall(): void {
    process.removeListener('SIGTERM', this.boundHandler);
    process.removeListener('SIGINT', this.boundHandler);
  }

  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  requestShutdown(reason: ShutdownReason): void {
    this.shutdownRequested = true;
    this.shutdownReason = reason;
    this.shutdownRequestedAt = new Date().toISOString();
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
