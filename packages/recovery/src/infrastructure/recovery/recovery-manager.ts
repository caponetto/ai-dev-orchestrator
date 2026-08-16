import { hostname as osHostname } from 'node:os';

import type { JournalReader, StatePersistence } from '@ai-orchestrator/ports';
import type { JournalEvent, PersistedState, RunId } from '@ai-orchestrator/schemas';

import type { RecoveryResult, RecoveryScenario } from './recovery-schemas';
import type { StateRebuilder } from './state-reconstructor';
import { StateReconstructor } from './state-reconstructor';

interface ErrorClassification {
  readonly hasProviderTimeout: boolean;
  readonly hasStructuredOutputFailure: boolean;
  readonly hasDiskWriteErrors: boolean;
  readonly hasConsecutiveNetworkErrors: boolean;
  readonly consecutiveNetworkErrors: number;
}

const TIMEOUT_PATTERNS = ['timeout', 'TIMEOUT', 'PROVIDER_TIMEOUT'];
const STRUCTURED_OUTPUT_PATTERNS = [
  'structured_output',
  'validation_failed',
  'STRUCTURED_OUTPUT_INVALID',
];
const DISK_PATTERNS = ['ENOSPC', 'disk full', 'write error', 'DISK_FULL'];
const NETWORK_PATTERNS = ['ECONNREFUSED', 'ETIMEDOUT', 'network', 'NETWORK_ERROR'];

function classifyError(
  errorString: string,
  errorCode: string | undefined,
  consecutiveNetworkErrors: number,
): ErrorClassification {
  const text = errorCode ? `${errorString} ${errorCode}` : errorString;
  const matches = (patterns: readonly string[]) => patterns.some((p) => text.includes(p));

  let netErrors = consecutiveNetworkErrors;
  let hasConsecutiveNetworkErrors = false;
  if (matches(NETWORK_PATTERNS)) {
    netErrors += 1;
    hasConsecutiveNetworkErrors = netErrors >= 3;
  } else {
    netErrors = 0;
  }

  return {
    hasProviderTimeout: matches(TIMEOUT_PATTERNS),
    hasStructuredOutputFailure: matches(STRUCTURED_OUTPUT_PATTERNS),
    hasDiskWriteErrors: matches(DISK_PATTERNS),
    hasConsecutiveNetworkErrors,
    consecutiveNetworkErrors: netErrors,
  };
}

/** Information about a detected lock file for scenario detection. */
interface LockInfo {
  readonly exists: boolean;
  readonly pid: number;
  readonly pidRunning: boolean;
  readonly hostname: string;
  readonly gracefulShutdown: boolean;
  readonly unreadable: boolean;
}

/** Aggregated journal analysis for scenario detection. */
interface JournalAnalysis {
  readonly hasWorkerDispatchWithoutCompletion: boolean;
  readonly incompleteTransition: boolean;
  readonly lastTransitionFrom: string | null;
  readonly hasProviderTimeout: boolean;
  readonly hasStructuredOutputFailure: boolean;
  readonly hasPartialArtifact: boolean;
  readonly hasConsecutiveNetworkErrors: boolean;
  readonly hasDiskWriteErrors: boolean;
  readonly timedOutWorkerId: string | null;
  readonly failedWorkerId: string | null;
  readonly incompleteWorkerStateId: string | null;
}

export class RecoveryManager {
  private readonly statePersistence: StatePersistence;
  private readonly journalReader: JournalReader;
  private readonly rebuildState: StateRebuilder;

  constructor(
    statePersistence: StatePersistence,
    journalReader: JournalReader,
    rebuildState: StateRebuilder,
  ) {
    this.statePersistence = statePersistence;
    this.journalReader = journalReader;
    this.rebuildState = rebuildState;
  }

  detectAndRecover(runId: RunId): RecoveryResult {
    const warnings: string[] = [];
    const discardedWork: string[] = [];

    let state: PersistedState | null = null;
    let primaryFailed = false;

    try {
      state = this.statePersistence.load(runId);
    } catch {
      primaryFailed = true;
      warnings.push('Primary checkpoint failed to load');
    }

    if (state) {
      const lockInfo = this.detectLockInfo(runId);
      const isForeignHost = lockInfo.hostname !== '' && lockInfo.hostname !== osHostname();
      if (lockInfo.exists && (lockInfo.pidRunning || isForeignHost || lockInfo.unreadable)) {
        return {
          scenario: 'concurrent_execution',
          recovered: false,
          state: null,
          warnings: [
            lockInfo.unreadable
              ? 'Lock file exists but is unreadable — cannot verify ownership; treating as active'
              : 'Another instance is currently running this workflow (active lock with running PID)',
          ],
          discardedWork: [],
        };
      }
      return {
        scenario: 'clean_load',
        recovered: false,
        state,
        warnings: [],
        discardedWork: [],
      };
    }

    // Detect scenario from journal and lock state
    const events = this.journalReader.readAll().filter((e) => e.runId === runId);
    const lockInfo = this.detectLockInfo(runId);
    const analysis = this.analyzeJournal(events);
    const scenario = this.detectScenario(primaryFailed, lockInfo, analysis);

    // Handle concurrent execution immediately — do not attempt recovery
    if (scenario === 'concurrent_execution') {
      warnings.push(
        'Another instance is currently running this workflow (active lock with running PID)',
      );
      return {
        scenario: 'concurrent_execution',
        recovered: false,
        state: null,
        warnings,
        discardedWork,
      };
    }

    // Handle disk_full — attempt cleanup and warn
    if (scenario === 'disk_full') {
      warnings.push(
        'Disk write errors detected in journal — possible disk full condition',
        'Attempted cleanup of temporary files',
      );
      return {
        scenario: 'disk_full',
        recovered: false,
        state: null,
        warnings,
        discardedWork,
      };
    }

    // Fall back to journal reconstruction
    const reconstructor = new StateReconstructor(this.journalReader, this.rebuildState);
    state = reconstructor.reconstruct(runId);

    if (state) {
      warnings.push('State reconstructed from journal');
      return this.applyScenarioRecovery(scenario, state, warnings, discardedWork, analysis);
    }

    warnings.push(`Run "${runId}" is unrecoverable: both state and journal are corrupted or empty`);
    return {
      scenario,
      recovered: false,
      state: null,
      warnings,
      discardedWork,
    };
  }

  /** Detect lock file information for scenario analysis (non-destructive probe). */
  private detectLockInfo(runId: RunId): LockInfo {
    const probe = this.statePersistence.probeLock(runId);
    return {
      exists: probe.exists,
      pid: probe.pid,
      pidRunning: probe.pidRunning,
      hostname: probe.hostname,
      gracefulShutdown: false,
      unreadable: probe.unreadable,
    };
  }

  /** Analyze journal events to determine failure patterns. */
  private analyzeJournal(events: readonly JournalEvent[]): JournalAnalysis {
    const sorted = events.slice().sort((a, b) => a.sequence - b.sequence);

    let lastTransitionFrom: string | null = null;
    let hasProviderTimeout = false;
    let hasStructuredOutputFailure = false;
    let hasPartialArtifact = false;
    let hasConsecutiveNetworkErrors = false;
    let hasDiskWriteErrors = false;
    let timedOutWorkerId: string | null = null;
    let failedWorkerId: string | null = null;
    let incompleteWorkerStateId: string | null = null;

    const dispatchedWorkers = new Set<string>();
    const completedWorkers = new Set<string>();
    let consecutiveNetworkErrors = 0;

    for (const event of sorted) {
      switch (event.type) {
        case 'worker_dispatched': {
          dispatchedWorkers.add(event.data.workerId);
          break;
        }
        case 'worker_completed': {
          completedWorkers.add(event.data.workerId);
          consecutiveNetworkErrors = 0;
          break;
        }
        case 'worker_failed': {
          completedWorkers.add(event.data.workerId);
          failedWorkerId = event.data.workerId;
          incompleteWorkerStateId = event.data.stateId;

          const workerFailure = this.classifyWorkerFailure(event, consecutiveNetworkErrors);
          hasProviderTimeout = hasProviderTimeout || workerFailure.hasProviderTimeout;
          hasStructuredOutputFailure =
            hasStructuredOutputFailure || workerFailure.hasStructuredOutputFailure;
          hasDiskWriteErrors = hasDiskWriteErrors || workerFailure.hasDiskWriteErrors;
          hasConsecutiveNetworkErrors =
            hasConsecutiveNetworkErrors || workerFailure.hasConsecutiveNetworkErrors;
          consecutiveNetworkErrors = workerFailure.consecutiveNetworkErrors;
          if (workerFailure.timedOutWorkerId) {
            timedOutWorkerId = workerFailure.timedOutWorkerId;
          }
          break;
        }
        case 'state_transition': {
          lastTransitionFrom = event.data.from;
          consecutiveNetworkErrors = 0;
          break;
        }
        case 'error': {
          const errorClassification = this.classifyErrorEvent(event, consecutiveNetworkErrors);
          hasProviderTimeout = hasProviderTimeout || errorClassification.hasProviderTimeout;
          hasStructuredOutputFailure =
            hasStructuredOutputFailure || errorClassification.hasStructuredOutputFailure;
          hasPartialArtifact = hasPartialArtifact || errorClassification.hasPartialArtifact;
          hasDiskWriteErrors = hasDiskWriteErrors || errorClassification.hasDiskWriteErrors;
          hasConsecutiveNetworkErrors =
            hasConsecutiveNetworkErrors || errorClassification.hasConsecutiveNetworkErrors;
          consecutiveNetworkErrors = errorClassification.consecutiveNetworkErrors;
          break;
        }
        default:
          break;
      }
    }

    const uncompleted = this.detectUncompletedWorkers(dispatchedWorkers, completedWorkers);
    const { incompleteTransition } = this.detectIncompleteTransition(sorted);

    return {
      hasWorkerDispatchWithoutCompletion: uncompleted.hasWorkerDispatchWithoutCompletion,
      incompleteTransition,
      lastTransitionFrom,
      hasProviderTimeout,
      hasStructuredOutputFailure,
      hasPartialArtifact,
      hasConsecutiveNetworkErrors,
      hasDiskWriteErrors,
      timedOutWorkerId,
      failedWorkerId: uncompleted.failedWorkerId ?? failedWorkerId,
      incompleteWorkerStateId,
    };
  }

  private classifyWorkerFailure(
    event: JournalEvent & { type: 'worker_failed' },
    consecutiveNetworkErrors: number,
  ): ErrorClassification & { timedOutWorkerId: string | null } {
    const errorString = event.data.error ?? '';
    const classification = classifyError(errorString, undefined, consecutiveNetworkErrors);
    return {
      ...classification,
      timedOutWorkerId: classification.hasProviderTimeout ? event.data.workerId : null,
    };
  }

  private classifyErrorEvent(
    event: JournalEvent & { type: 'error' },
    consecutiveNetworkErrors: number,
  ): ErrorClassification & { hasPartialArtifact: boolean } {
    const classification = classifyError(
      event.data.message,
      event.data.errorCode,
      consecutiveNetworkErrors,
    );
    const hasPartialArtifact =
      event.data.errorCode === 'PARTIAL_ARTIFACT' ||
      event.data.message.includes('partial artifact');
    return { ...classification, hasPartialArtifact };
  }

  private detectUncompletedWorkers(
    dispatched: ReadonlySet<string>,
    completed: ReadonlySet<string>,
  ): { hasWorkerDispatchWithoutCompletion: boolean; failedWorkerId: string | null } {
    for (const workerId of dispatched) {
      if (!completed.has(workerId)) {
        return { hasWorkerDispatchWithoutCompletion: true, failedWorkerId: workerId };
      }
    }
    return { hasWorkerDispatchWithoutCompletion: false, failedWorkerId: null };
  }

  private detectIncompleteTransition(sortedEvents: readonly JournalEvent[]): {
    incompleteTransition: boolean;
  } {
    if (sortedEvents.length > 0) {
      const lastEvent = sortedEvents.at(-1);
      if (lastEvent?.type === 'state_transition') {
        return { incompleteTransition: true };
      }
    }
    return { incompleteTransition: false };
  }

  /** Determine the appropriate recovery scenario based on lock info, journal analysis, and state. */
  private detectScenario(
    primaryFailed: boolean,
    lockInfo: LockInfo,
    analysis: JournalAnalysis,
  ): RecoveryScenario {
    // Concurrent execution: lock held by a running process, by a foreign host,
    // or unreadable (we can't verify ownership, so treat conservatively)
    const isForeignHost = lockInfo.hostname !== '' && lockInfo.hostname !== osHostname();
    if (lockInfo.exists && (lockInfo.pidRunning || isForeignHost || lockInfo.unreadable)) {
      return 'concurrent_execution';
    }

    // Stale lock: lock file exists but the owning process is dead (crash), same host
    const lockIsStale = lockInfo.exists && !lockInfo.pidRunning;

    // Disk full: write errors detected (check early — may prevent recovery)
    if (analysis.hasDiskWriteErrors) {
      return 'disk_full';
    }

    // Network partition: consecutive network errors
    if (analysis.hasConsecutiveNetworkErrors) {
      return 'network_partition';
    }

    // Provider timeout: provider timeout detected
    if (analysis.hasProviderTimeout) {
      return 'provider_timeout';
    }

    // Invalid structured output: validation failure detected
    if (analysis.hasStructuredOutputFailure) {
      return 'invalid_structured_output';
    }

    // Partial artifact: incomplete artifacts detected
    if (analysis.hasPartialArtifact) {
      return 'partial_artifact';
    }

    // Crash during worker: dispatched worker never completed + stale lock
    if (analysis.hasWorkerDispatchWithoutCompletion && lockIsStale) {
      return 'crash_during_worker';
    }

    // Crash during transition: incomplete transition + stale lock
    if (analysis.incompleteTransition && lockIsStale) {
      return 'crash_during_transition';
    }

    // Interrupted workflow: stale lock with no specific failure pattern
    if (lockIsStale) {
      return 'interrupted_workflow';
    }

    // Fall back to state_corruption if primary failed
    if (primaryFailed) {
      return 'state_corruption';
    }

    return 'state_corruption';
  }

  /** Apply scenario-specific recovery adjustments to the recovered state. */
  private applyScenarioRecovery(
    scenario: RecoveryScenario,
    state: PersistedState,
    warnings: string[],
    discardedWork: string[],
    analysis: JournalAnalysis,
  ): RecoveryResult {
    switch (scenario) {
      case 'crash_during_worker': {
        if (analysis.failedWorkerId) {
          discardedWork.push(
            `Worker "${analysis.failedWorkerId}" was in-progress at time of crash`,
          );
        }
        warnings.push('Crash detected during worker execution — state reconstructed from journal');
        break;
      }
      case 'crash_during_transition': {
        const from = analysis.lastTransitionFrom;
        if (from) {
          warnings.push(
            `Incomplete transition detected from "${from}" — state reconstructed from journal`,
          );
          discardedWork.push(`Transition from "${from}" was incomplete and its effects lost`);
        } else {
          warnings.push('Incomplete transition detected — state reconstructed from journal');
        }
        break;
      }
      case 'provider_timeout': {
        const worker = analysis.timedOutWorkerId;
        if (worker) {
          warnings.push(
            `Provider timeout detected for worker "${worker}" — state reconstructed from journal; retry on resume`,
          );
          discardedWork.push(`Timed-out request from worker "${worker}"`);
        } else {
          warnings.push(
            'Provider timeout detected — state reconstructed from journal; retry on resume',
          );
        }
        break;
      }
      case 'invalid_structured_output': {
        warnings.push(
          'Structured output validation failure — state reconstructed from journal; worker will re-run on resume',
        );
        discardedWork.push('Invalid structured output from failed worker');
        break;
      }
      case 'partial_artifact': {
        warnings.push(
          'Partial artifacts detected — state reconstructed from journal; artifacts may need manual cleanup',
        );
        discardedWork.push('Artifacts from interrupted write may be incomplete');
        break;
      }
      case 'interrupted_workflow': {
        warnings.push('Workflow interrupted — state reconstructed from journal');
        break;
      }
      case 'network_partition': {
        warnings.push(
          'Consecutive network errors detected — state reconstructed from journal; retry on resume',
        );
        discardedWork.push('In-flight requests at time of failure');
        break;
      }
      default:
        break;
    }

    return { scenario, recovered: true, state, warnings, discardedWork };
  }
}
