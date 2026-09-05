import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { LiveRequest } from '@ai-dev-orchestrator/runner';
import { RUN_LOCK_FILENAME } from '@ai-dev-orchestrator/schemas';
import type { JournalEvent, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getJournalPath, getRunsDir } from '../workspace-paths';

import { findLatestRunId } from './find-run';

export interface StatusOptions {
  readonly runId: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly watch: boolean;
}

export interface ResolvedRunState {
  readonly state: PersistedState;
  readonly runDir: string;
}

function computeStatus(currentState: string): string {
  if (currentState === 'DONE') {
    return 'completed';
  }
  if (currentState === 'FAILED') {
    return 'failed';
  }
  if (currentState === 'ABORTED') {
    return 'aborted';
  }
  if (currentState === 'WAITING_FOR_HUMAN') {
    return 'waiting';
  }
  return 'running';
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${String(minutes)}m ${String(remainingSeconds)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours)}h ${String(remainingMinutes)}m`;
}

export function resolveRunState(
  runId: string,
  runsDir: string,
  formatter: OutputFormatter,
): ResolvedRunState | ExitCode {
  const runDir = join(runsDir, runId);

  if (!existsSync(runDir)) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Run directory not found: ${runId}`,
      remediation: 'Check the run ID and try again.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const statePersistence = new DefaultStatePersistence(runsDir);
  let state: PersistedState | null = null;
  let loadFailed = false;

  try {
    state = statePersistence.load(runId as RunId);
  } catch {
    loadFailed = true;
  }

  if (!state) {
    const journalPath = getJournalPath(runDir);
    const journalReader = new DefaultJournalReader(journalPath);
    state = statePersistence.reconstructFromJournal(runId as RunId, journalReader.readAll());
    if (state) {
      const reason = loadFailed ? 'Checkpoint corrupt' : 'Checkpoint missing';
      formatter.info(`${reason} — reconstructed state from journal`);
    }
  }

  if (!state) {
    const lockPath = join(runDir, RUN_LOCK_FILENAME);
    if (existsSync(lockPath)) {
      state = buildMinimalState(runId as RunId, lockPath);
      formatter.info('No checkpoint yet — showing initial state from lock file');
    }
  }

  if (!state) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `No state found for run: ${runId}`,
      remediation: 'The run has no checkpoint, journal, or lock file to reconstruct from.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  return { state, runDir };
}

export function emitJsonStatus(
  state: PersistedState,
  events: readonly JournalEvent[],
  elapsedMs: number,
): void {
  const status = computeStatus(state.currentState);
  process.stdout.write(
    JSON.stringify({
      runId: state.runId,
      status,
      currentState: state.currentState,
      previousState: state.previousState,
      transitionCount: state.transitionCount,
      stateHistory: state.stateHistory,
      artifactCount: state.activeArtifacts.length,
      iterationCounts: state.iterationCounts,
      elapsedMs,
      waitingContext: state.waitingContext ?? null,
      eventCount: events.length,
      tokens: {
        inputTokens: state.cumulativeInputTokens ?? 0,
        outputTokens: state.cumulativeOutputTokens ?? 0,
      },
    }) + '\n',
  );
}

export function formatWaitingContext(
  waitingContext: NonNullable<PersistedState['waitingContext']>,
  formatter: OutputFormatter,
): void {
  formatter.section('Waiting');
  const waitingPairs: Record<string, unknown> = {
    Reason: waitingContext.reason,
    'Required Input': waitingContext.requiredInput,
    Since: waitingContext.waitingSince,
  };
  if (waitingContext.liveSessionId) {
    waitingPairs['Session ID'] = waitingContext.liveSessionId;
    waitingPairs['Request Type'] = waitingContext.liveRequestType ?? 'unknown';
    waitingPairs['Transport'] = waitingContext.sessionTransport ?? 'unknown';
    if (waitingContext.pendingRequestId) {
      waitingPairs['Request ID'] = waitingContext.pendingRequestId;
    }
  }
  const be = waitingContext.budgetExhaustion;
  if (be) {
    waitingPairs['Limit Type'] = be.limitType;
    waitingPairs['Current Tokens'] = be.current;
    waitingPairs['Token Limit'] = be.limit;
    if (be.role) {
      waitingPairs['Role'] = be.role;
    }
  }
  formatter.keyValue(waitingPairs);
}

export function formatRecentEvents(
  events: readonly JournalEvent[],
  verbose: boolean,
  formatter: OutputFormatter,
): void {
  const recentEvents = verbose ? events : events.slice(-10);
  if (recentEvents.length > 0) {
    formatter.section('Recent Events');
    for (const event of recentEvents) {
      const time = event.timestamp.split('T')[1]?.split('.')[0] ?? event.timestamp;
      formatter.info(`  ${time}  ${event.type}  ${formatEventSummary(event.data)}`);
    }
    if (!verbose && events.length > 10) {
      formatter.info(`  ... ${String(events.length - 10)} more events (use --verbose to show all)`);
    }
  }
}

export function emitFormattedStatus(
  state: PersistedState,
  events: readonly JournalEvent[],
  elapsedMs: number,
  options: StatusOptions,
  formatter: OutputFormatter,
): void {
  const status = computeStatus(state.currentState);

  formatter.section(`Run: ${state.runId}`);
  formatter.keyValue({
    Status: status,
    State: `${state.currentState} (entered ${formatElapsed(elapsedMs)} ago)`,
    Previous: state.previousState ?? '(none)',
    Transitions: state.transitionCount,
    Artifacts: state.activeArtifacts.length,
  });

  if (state.cumulativeInputTokens != null || state.cumulativeOutputTokens != null) {
    formatter.section('Token Usage');
    formatter.keyValue({
      'Input Tokens': state.cumulativeInputTokens ?? 0,
      'Output Tokens': state.cumulativeOutputTokens ?? 0,
    });
  }

  if (state.waitingContext) {
    formatWaitingContext(state.waitingContext, formatter);
  }

  const iterationEntries = Object.entries(state.iterationCounts);
  if (iterationEntries.length > 0) {
    formatter.section('Iterations');
    const iterationPairs: Record<string, unknown> = {};
    for (const [key, value] of iterationEntries) {
      iterationPairs[key] = value;
    }
    formatter.keyValue(iterationPairs);
  }

  formatRecentEvents(events, options.verbose, formatter);
}

export async function statusCommand(
  options: StatusOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const runId = options.runId ?? findLatestRunId();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No runs found.',
      remediation: 'Start a run first: ai run "your prompt"',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const runsDir = getRunsDir();
  const result = resolveRunState(runId, runsDir, formatter);

  if (typeof result === 'number') {
    return result;
  }

  const { state, runDir } = result;

  const journalPath = getJournalPath(runDir);
  const journalReader = new DefaultJournalReader(journalPath);
  const events = journalReader.readAll();

  const elapsedMs = Date.now() - new Date(state.stateEnteredAt).getTime();

  if (options.json) {
    emitJsonStatus(state, events, elapsedMs);
    return ExitCode.SUCCESS;
  }

  emitFormattedStatus(state, events, elapsedMs, options, formatter);

  const liveStore = new FileBackedLiveRequestStore(runsDir);
  const pendingRequests = await liveStore.listPendingRequests(runId);

  if (pendingRequests.length > 0) {
    formatter.section('Pending Live Requests');
    for (const req of pendingRequests) {
      formatLiveRequest(req, formatter);
    }
  }

  if (options.watch) {
    await watchLiveRequests(runId, liveStore, formatter);
  }

  return ExitCode.SUCCESS;
}

function formatEventSummary(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return '';
  }
  const record = data as Record<string, unknown>;
  if ('to' in record && typeof record['to'] === 'string') {
    return record['to'];
  }
  if ('role' in record && typeof record['role'] === 'string') {
    return record['role'];
  }
  if ('status' in record && typeof record['status'] === 'string') {
    return record['status'];
  }
  return '';
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function formatLiveRequest(req: LiveRequest, formatter: OutputFormatter): void {
  const payload = req.payload;
  if (req.kind === 'permission') {
    const action = str(payload['action'], 'unknown action');
    const resource = str(payload['resource'], '');
    const risk = str(payload['riskLevel'], 'unknown');
    formatter.info(`  [PERMISSION REQUIRED] ${action} ${resource}`);
    if (typeof payload['detail'] === 'string') {
      formatter.info(`    Detail: ${payload['detail']}`);
    }
    formatter.info(`    Risk: ${risk}`);
    formatter.info('    Run `ai permit` to approve or `ai permit --deny` to reject');
  } else {
    const question = str(payload['question'], 'No question provided');
    formatter.info(`  [CLARIFICATION NEEDED] ${question}`);
    if (typeof payload['context'] === 'string') {
      formatter.info(`    Context: ${payload['context']}`);
    }
    formatter.info('    Run `ai answer <runId> "your answer"` to respond');
  }
}

function buildMinimalState(runId: RunId, lockPath: string): PersistedState {
  let acquiredAt = new Date().toISOString();
  try {
    const lock = parse(readFileSync(lockPath, 'utf8')) as { acquiredAt?: string };
    if (lock.acquiredAt) {
      acquiredAt = lock.acquiredAt;
    }
  } catch {
    // Best-effort — use current time as fallback
  }

  return {
    runId,
    schemaVersion: 1,
    currentState: 'INTAKE',
    previousState: null,
    stateEnteredAt: acquiredAt,
    transitionCount: 0,
    stateHistory: ['INTAKE'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: acquiredAt,
    persistenceVersion: 0,
    checksum: '',
  };
}

const WATCH_POLL_MS = 2000;

async function watchLiveRequests(
  runId: string,
  store: FileBackedLiveRequestStore,
  formatter: OutputFormatter,
): Promise<void> {
  const seenIds = new Set<string>();

  // Seed with already-displayed requests
  const initial = await store.listPendingRequests(runId);
  for (const r of initial) {
    seenIds.add(r.messageId);
  }

  formatter.info('\nWatching for live requests... (Ctrl+C to stop)\n');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      clearInterval(timer);
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    const timer = setInterval(() => {
      void store.listPendingRequests(runId).then((pending) => {
        for (const req of pending) {
          if (!seenIds.has(req.messageId)) {
            seenIds.add(req.messageId);
            formatLiveRequest(req, formatter);
          }
        }
      });
    }, WATCH_POLL_MS);
  });
}
