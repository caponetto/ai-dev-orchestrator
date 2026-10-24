import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import type { StatePersistence } from '@ai-dev-orchestrator/ports';
import { RUN_LOCK_FILENAME } from '@ai-dev-orchestrator/schemas';
import type { JournalEvent, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
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

/** Replay durable journal progress beyond the last successfully written checkpoint. */
export function loadLatestRunState(
  statePersistence: Pick<StatePersistence, 'load' | 'reconstructFromJournal'>,
  runId: RunId,
  events: readonly JournalEvent[],
): Pick<RecoveredRunState, 'state' | 'source'> {
  let checkpoint: PersistedState | null = null;
  try {
    checkpoint = statePersistence.load(runId);
  } catch {
    // A damaged checkpoint can still be recovered from the journal.
  }
  const runEvents = events
    .filter((event) => event.runId === runId)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  if (checkpoint) {
    const checkpointContent = comparableCheckpoint(checkpoint);
    let matchingIndex = -1;
    let latestSnapshot: PersistedState | undefined;
    for (const [index, event] of runEvents.entries()) {
      if (event.type === 'workflow_checkpoint') {
        latestSnapshot = event.data.state;
        if (isDeepStrictEqual(comparableCheckpoint(event.data.state), checkpointContent)) {
          matchingIndex = index;
        }
      }
    }
    const hasNewerSnapshot = latestSnapshot && latestSnapshot.persistedAt > checkpoint.persistedAt;
    // Checkpoint-only edits (for example dashboard retry) supersede older journal snapshots.
    if ((matchingIndex < 0 && !hasNewerSnapshot) || matchingIndex === runEvents.length - 1) {
      return { state: checkpoint, source: 'checkpoint' };
    }
    const replay = statePersistence.reconstructFromJournal(
      runId,
      matchingIndex >= 0 ? runEvents.slice(matchingIndex) : runEvents,
    );
    return replay
      ? { state: replay, source: 'journal' }
      : { state: checkpoint, source: 'checkpoint' };
  }
  const journalState = statePersistence.reconstructFromJournal(runId, runEvents);
  if (journalState) {
    return { state: journalState, source: 'journal' };
  }
  return { state: null, source: null };
}

function comparableCheckpoint(state: PersistedState): unknown {
  const { checksum: _checksum, ...content } = state;
  // JSON matches journal serialization: omit undefined properties and ignore key ordering.
  return JSON.parse(JSON.stringify(content)) as unknown;
}

export function recoverRunState(runsDir: string, runId: string): RecoveredRunState {
  const runDir = join(runsDir, runId);
  const statePersistence = new DefaultStatePersistence(runsDir);
  const journalReader = new DefaultJournalReader(getJournalPath(runDir));
  const recovered = loadLatestRunState(statePersistence, runId as RunId, journalReader.readAll());
  if (recovered.state) {
    return { ...recovered, lock: null };
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
