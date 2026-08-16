import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-orchestrator/core';
import { createRunId } from '@ai-orchestrator/ports';
import type {
  JournalEvent,
  PersistedState,
  PersistedWaitingContext,
  RunId,
} from '@ai-orchestrator/schemas';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import { OutputFormatter } from '../../output/formatter';
import { getRunDir, getRunsDir } from '../../workspace-paths';
import {
  emitFormattedStatus,
  emitJsonStatus,
  formatRecentEvents,
  formatWaitingContext,
  resolveRunState,
  statusCommand,
} from '../status';

vi.mock('../../workspace-paths', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAiDir: vi.fn(),
    getRunsDir: vi.fn(),
    getRunDir: vi.fn(),
    getDashboardLogPath: vi.fn(),
  };
});

const mockPendingRequests = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@ai-orchestrator/runner', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    FileBackedLiveRequestStore: class {
      listPendingRequests = mockPendingRequests;
    },
  };
});

function makeEvent(seq: number): JournalEvent {
  return {
    timestamp: `2026-07-11T10:00:${String(seq).padStart(2, '0')}.000Z`,
    runId: 'run-1',
    sequence: seq,
    type: 'state_transition',
    data: { kind: 'state_transition', from: 'INTAKE', to: 'PLANNING', trigger: 'completion' },
  } as JournalEvent;
}

function makeEventWithData(seq: number, type: string, data: unknown): JournalEvent {
  return {
    timestamp: `2026-07-11T10:00:${String(seq).padStart(2, '0')}.000Z`,
    runId: 'run-1',
    sequence: seq,
    type,
    data,
  } as JournalEvent;
}

describe('statusCommand', () => {
  let baseDir: string;
  let stdoutChunks: string[];

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-status-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockPendingRequests.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns GENERAL_ERROR when no runs found', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('displays state from persisted state', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLAN_REVIEW');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain(runId);
    expect(output).toContain('PLAN_REVIEW');
    expect(output).toContain('running');
  });

  it('displays terminal state correctly', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'DONE');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('completed');
  });

  it('produces valid JSON output', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ json: true });
    const code = await statusCommand(
      { runId, json: true, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      runId: string;
      currentState: string;
      status: string;
      transitionCount: number;
      elapsedMs: number;
      eventCount: number;
    };
    expect(parsed.runId).toBe(runId);
    expect(parsed.currentState).toBe('PLANNING');
    expect(parsed.status).toBe('running');
    expect(parsed.transitionCount).toBe(3);
    expect(parsed).toHaveProperty('elapsedMs');
    expect(parsed).toHaveProperty('eventCount');
  });

  it('displays iteration counts', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLAN_REVIEW');

    const formatter = new OutputFormatter({ noColor: true });
    await statusCommand({ runId, json: false, verbose: false, watch: false }, formatter);
    const output = stdoutChunks.join('');
    expect(output).toContain('Iterations');
    expect(output).toContain('plan_review');
  });

  it('falls back to lock file when no checkpoint or journal exists', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const lockData = [
      `runId: ${runId}`,
      `pid: ${String(process.pid)}`,
      `acquiredAt: "2026-07-11T12:00:00.000Z"`,
      `lockPath: ${join(runDir, 'run.lock')}`,
      `hostname: test-host`,
    ].join('\n');
    writeFileSync(join(runDir, 'run.lock'), lockData, 'utf8');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain(runId);
    expect(output).toContain('INTAKE');
    expect(output).toContain('running');
  });

  it('reconstructs state from journal when no checkpoint exists', async () => {
    const runId = createRunId();
    const runDir = getRunDir(runId);
    mkdirSync(runDir, { recursive: true });

    const journal = [
      '# Journal',
      '',
      '```yaml',
      'type: run_started',
      `runId: ${runId}`,
      'sequence: 1',
      'timestamp: "2026-07-11T12:00:00.000Z"',
      'data:',
      '  kind: run_lifecycle',
      '  workflowName: default',
      '  workflowVersion: "1.0.0"',
      '```',
      '',
      '```yaml',
      'type: state_transition',
      `runId: ${runId}`,
      'sequence: 2',
      'timestamp: "2026-07-11T12:00:01.000Z"',
      'data:',
      '  kind: state_transition',
      '  from: INTAKE',
      '  to: REFINEMENT',
      '  trigger: completion',
      '```',
    ].join('\n');
    writeFileSync(join(runDir, 'journal.md'), journal, 'utf8');

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain(runId);
    expect(output).toContain('REFINEMENT');
  });

  it('returns GENERAL_ERROR for non-existent run', async () => {
    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId: 'nonexistent', json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.GENERAL_ERROR);
  });

  it('displays pending permission requests with detail', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'WAITING_FOR_HUMAN');

    mockPendingRequests.mockResolvedValueOnce([
      {
        messageId: 'msg-1',
        kind: 'permission',
        runId,
        payload: {
          action: 'file_write',
          resource: '/src/foo.ts',
          riskLevel: 'high',
          detail: 'Writing to production file',
        },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('PERMISSION REQUIRED');
    expect(output).toContain('file_write');
    expect(output).toContain('high');
    expect(output).toContain('Writing to production file');
  });

  it('displays pending clarification requests with context', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'WAITING_FOR_HUMAN');

    mockPendingRequests.mockResolvedValueOnce([
      {
        messageId: 'msg-2',
        kind: 'clarification',
        runId,
        payload: {
          question: 'Which database to use?',
          context: 'We support PostgreSQL and MySQL',
        },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const formatter = new OutputFormatter({ noColor: true });
    const code = await statusCommand(
      { runId, json: false, verbose: false, watch: false },
      formatter,
    );
    expect(code).toBe(ExitCode.SUCCESS);
    const output = stdoutChunks.join('');
    expect(output).toContain('CLARIFICATION NEEDED');
    expect(output).toContain('Which database to use?');
    expect(output).toContain('We support PostgreSQL and MySQL');
  });
});

describe('resolveRunState', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `ai-test-resolve-${String(Date.now())}`);
    mkdirSync(baseDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(join(baseDir, 'runs'));
    vi.mocked(getRunDir).mockImplementation((runId: string) => join(baseDir, 'runs', runId));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns GENERAL_ERROR when run directory does not exist', () => {
    const runsDir = getRunsDir();
    mkdirSync(runsDir, { recursive: true });
    const formatter = new OutputFormatter({ noColor: true });
    const result = resolveRunState('nonexistent-run', runsDir, formatter);
    expect(result).toBe(ExitCode.GENERAL_ERROR);
  });

  it('resolves state from checkpoint', async () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    await createAndSaveState(runsDir, runId, 'PLANNING');

    const formatter = new OutputFormatter({ noColor: true });
    const result = resolveRunState(runId, runsDir, formatter);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.state.currentState).toBe('PLANNING');
      expect(result.runDir).toBe(join(runsDir, runId));
    }
  });

  it('falls back to lock file when no checkpoint or journal', () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    const lockData = `runId: ${runId}\npid: 1234\nacquiredAt: "2026-07-11T10:00:00.000Z"\nhostname: test`;
    writeFileSync(join(runDir, 'run.lock'), lockData, 'utf8');

    const formatter = new OutputFormatter({ noColor: true });
    const result = resolveRunState(runId, runsDir, formatter);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.state.currentState).toBe('INTAKE');
    }
  });

  it('returns GENERAL_ERROR when no state source exists', () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    const formatter = new OutputFormatter({ noColor: true });
    const result = resolveRunState(runId, runsDir, formatter);
    expect(result).toBe(ExitCode.GENERAL_ERROR);
  });

  it('handles corrupt lock file gracefully', () => {
    const runId = createRunId();
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(join(runDir, 'run.lock'), '{{invalid yaml content', 'utf8');

    const formatter = new OutputFormatter({ noColor: true });
    const result = resolveRunState(runId, runsDir, formatter);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.state.currentState).toBe('INTAKE');
    }
  });
});

describe('formatWaitingContext', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats basic waiting context with reason and required input', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const context: PersistedWaitingContext = {
      reason: 'Need clarification',
      requiredInput: 'architecture decision',
      requestingState: 'PLANNING',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-07-11T10:00:00.000Z',
    };

    formatWaitingContext(context, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('Waiting');
    expect(output).toContain('Need clarification');
    expect(output).toContain('architecture decision');
    expect(output).toContain('2026-07-11T10:00:00.000Z');
  });

  it('formats budget exhaustion details', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const context: PersistedWaitingContext = {
      reason: 'Budget exhausted',
      requiredInput: 'increase budget',
      requestingState: 'IMPLEMENTATION',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-07-11T10:00:00.000Z',
      budgetExhaustion: {
        limitType: 'token',
        current: 50000,
        limit: 40000,
        role: 'implementer',
        cumulativeTokens: 50000,
      },
    };

    formatWaitingContext(context, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('token');
    expect(output).toContain('50000');
    expect(output).toContain('40000');
    expect(output).toContain('implementer');
  });

  it('formats live session details', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const context: PersistedWaitingContext = {
      reason: 'Permission needed',
      requiredInput: 'approval',
      requestingState: 'IMPLEMENTATION',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-07-11T10:00:00.000Z',
      liveSessionId: 'session-123',
      liveRequestType: 'permission',
      sessionTransport: 'stdio',
      pendingRequestId: 'req-456',
    };

    formatWaitingContext(context, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('session-123');
    expect(output).toContain('permission');
    expect(output).toContain('stdio');
    expect(output).toContain('req-456');
  });
});

describe('formatRecentEvents', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows all events when fewer than 10', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('Recent Events');
    expect(output).not.toContain('more events');
  });

  it('truncates to last 10 events when not verbose', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = Array.from({ length: 15 }, (_, i) => makeEvent(i + 1));

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('5 more events');
    expect(output).toContain('--verbose');
  });

  it('shows all events in verbose mode', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = Array.from({ length: 15 }, (_, i) => makeEvent(i + 1));

    formatRecentEvents(events, true, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('Recent Events');
    expect(output).not.toContain('more events');
  });

  it('renders nothing when events array is empty', () => {
    const formatter = new OutputFormatter({ noColor: true });

    formatRecentEvents([], false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toBe('');
  });

  it('shows event summary with "to" field in data', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'state_transition', { to: 'PLANNING' })];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('PLANNING');
  });

  it('shows event summary with "role" field in data', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'role_assigned', { role: 'implementer' })];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('implementer');
  });

  it('shows event summary with "status" field in data', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'artifact_produced', { status: 'completed' })];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('completed');
  });

  it('shows event with non-object data as empty summary', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'custom_event', 'just a string')];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('custom_event');
    // Non-object data produces empty summary, so no extra text after type
    expect(output).toContain('custom_event  ');
  });

  it('shows event with null data as empty summary', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'custom_event', null)];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('custom_event');
  });

  it('shows event with object data without known fields as empty summary', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const events = [makeEventWithData(1, 'custom_event', { unknown: true })];

    formatRecentEvents(events, false, formatter);

    const output = stdoutChunks.join('');
    expect(output).toContain('custom_event');
    expect(output).not.toContain('true');
  });
});

describe('emitJsonStatus', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('outputs valid JSON with all required fields', () => {
    const state: PersistedState = {
      runId: 'run-test-001' as RunId,
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 2,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: { plan_review: 1 },
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
    };

    emitJsonStatus(state, [], 5000);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed['runId']).toBe('run-test-001');
    expect(parsed['status']).toBe('running');
    expect(parsed['currentState']).toBe('PLANNING');
    expect(parsed['transitionCount']).toBe(2);
    expect(parsed['elapsedMs']).toBe(5000);
    expect(parsed['eventCount']).toBe(0);
  });

  it('outputs WAITING_FOR_HUMAN as waiting status', () => {
    const state: PersistedState = {
      runId: 'run-test-002' as RunId,
      schemaVersion: 1,
      currentState: 'WAITING_FOR_HUMAN',
      previousState: 'PLANNING',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 3,
      stateHistory: ['INTAKE', 'PLANNING', 'WAITING_FOR_HUMAN'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
      waitingContext: {
        reason: 'test',
        requiredInput: 'approval',
        requestingState: 'PLANNING',
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: new Date().toISOString(),
      },
    };

    emitJsonStatus(state, [], 1000);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as Record<string, unknown>;
    expect(parsed['status']).toBe('waiting');
    expect(parsed['waitingContext']).not.toBeNull();
  });

  it('includes token counts when present', () => {
    const state: PersistedState = {
      runId: 'run-test-003' as RunId,
      schemaVersion: 1,
      currentState: 'DONE',
      previousState: 'IMPLEMENTATION',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 5,
      stateHistory: ['INTAKE', 'PLANNING', 'IMPLEMENTATION', 'DONE'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
      cumulativeInputTokens: 10000,
      cumulativeOutputTokens: 5000,
    };

    emitJsonStatus(state, [], 2000);

    const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
      tokens: { inputTokens: number; outputTokens: number };
    };
    expect(parsed.tokens.inputTokens).toBe(10000);
    expect(parsed.tokens.outputTokens).toBe(5000);
  });
});

describe('emitFormattedStatus', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('displays aborted status correctly', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const state: PersistedState = {
      runId: 'run-test-aborted' as RunId,
      schemaVersion: 1,
      currentState: 'ABORTED',
      previousState: 'IMPLEMENTATION',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 3,
      stateHistory: ['INTAKE', 'IMPLEMENTATION', 'ABORTED'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
    };

    emitFormattedStatus(
      state,
      [],
      1000,
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );

    const output = stdoutChunks.join('');
    expect(output).toContain('aborted');
  });

  it('displays token usage section when tokens are present', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const state: PersistedState = {
      runId: 'run-test-tokens' as RunId,
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 1,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
      cumulativeInputTokens: 15000,
      cumulativeOutputTokens: 8000,
    };

    emitFormattedStatus(
      state,
      [],
      1000,
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );

    const output = stdoutChunks.join('');
    expect(output).toContain('Token Usage');
    expect(output).toContain('15000');
    expect(output).toContain('8000');
  });

  it('formats elapsed time as seconds when under 60s', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const state: PersistedState = {
      runId: 'run-elapsed-s' as RunId,
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 1,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
    };

    emitFormattedStatus(
      state,
      [],
      30000,
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );

    const output = stdoutChunks.join('');
    expect(output).toContain('30s ago');
  });

  it('formats elapsed time as minutes and seconds when under 60m', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const state: PersistedState = {
      runId: 'run-elapsed-m' as RunId,
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 1,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
    };

    emitFormattedStatus(
      state,
      [],
      150000,
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );

    const output = stdoutChunks.join('');
    expect(output).toContain('2m 30s ago');
  });

  it('formats elapsed time as hours and minutes when 60m or more', () => {
    const formatter = new OutputFormatter({ noColor: true });
    const state: PersistedState = {
      runId: 'run-elapsed-h' as RunId,
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: new Date().toISOString(),
      transitionCount: 1,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: new Date().toISOString(),
      persistenceVersion: 1,
      checksum: '',
    };

    emitFormattedStatus(
      state,
      [],
      3700000,
      { runId: null, json: false, verbose: false, watch: false },
      formatter,
    );

    const output = stdoutChunks.join('');
    expect(output).toContain('1h 1m ago');
  });
});

async function createAndSaveState(
  runsDir: string,
  runId: RunId,
  currentState: string,
): Promise<void> {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const state: PersistedState = {
    runId,
    schemaVersion: 1,
    currentState,
    previousState: 'INTAKE',
    stateEnteredAt: new Date().toISOString(),
    transitionCount: 3,
    stateHistory: ['INTAKE', 'PLANNING', currentState],
    iterationCounts: { plan_review: 1 },
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: new Date().toISOString(),
    persistenceVersion: 1,
    checksum: '',
  };

  const persistence = new DefaultStatePersistence(runsDir);
  await persistence.save(state);
}
