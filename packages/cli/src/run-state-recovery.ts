import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import { RUN_LOCK_FILENAME } from '@ai-dev-orchestrator/schemas';
import type { PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

import { getJournalPath } from './workspace-paths';

type RecoveredStateSource = 'checkpoint' | 'journal' | 'lock';

interface LockMetadata {
  readonly pid?: number;
  readonly acquiredAt?: string;
  readonly hostname?: string;
}

export interface RecoveredRunState {
  readonly state: PersistedState | null;
  readonly source: RecoveredStateSource | null;
  readonly lock: LockMetadata | null;
}

export function recoverRunState(runsDir: string, runId: string): RecoveredRunState {
  const runDir = join(runsDir, runId);
  const statePersistence = new DefaultStatePersistence(runsDir);

  try {
    const checkpoint = statePersistence.load(runId as RunId);
    if (checkpoint) {
      return { state: checkpoint, source: 'checkpoint', lock: null };
    }
  } catch {
    // Fall through to journal/lock reconstruction.
  }

  const journalReader = new DefaultJournalReader(getJournalPath(runDir));
  const journalState = statePersistence.reconstructFromJournal(
    runId as RunId,
    journalReader.readAll(),
  );
  if (journalState) {
    return { state: journalState, source: 'journal', lock: null };
  }

  const lockPath = join(runDir, RUN_LOCK_FILENAME);
  if (!existsSync(lockPath)) {
    return { state: null, source: null, lock: null };
  }

  const lock = readLockMetadata(lockPath);
  return {
    state: buildMinimalState(runId as RunId, lock?.acquiredAt),
    source: 'lock',
    lock,
  };
}

export function terminateRunFromLock(lock: LockMetadata | null): void {
  if (!lock?.pid || lock.hostname !== hostname()) {
    return;
  }

  // Kill the entire process group so child agent processes are also terminated.
  // The run process is spawned with detached:true, making it a process group leader.
  try {
    process.kill(-lock.pid, 'SIGTERM');
  } catch {
    // Process group kill may fail if the process is not a group leader;
    // fall back to killing just the orchestrator PID.
    try {
      process.kill(lock.pid, 'SIGTERM');
    } catch {
      // Best-effort abort for lock-only runs.
    }
  }
}

export function readLockMetadata(lockPath: string): LockMetadata | null {
  try {
    const parsed = parse(readFileSync(lockPath, 'utf8')) as LockMetadata;
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : undefined,
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : undefined,
    };
  } catch {
    return null;
  }
}

function buildMinimalState(runId: RunId, acquiredAt?: string): PersistedState {
  const timestamp = acquiredAt ?? new Date().toISOString();
  return {
    runId,
    schemaVersion: 1,
    currentState: 'INTAKE',
    previousState: null,
    stateEnteredAt: timestamp,
    transitionCount: 0,
    stateHistory: ['INTAKE'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'dev',
    workflowVersion: '1.0.0',
    persistedAt: timestamp,
    persistenceVersion: 0,
    checksum: '',
  };
}
