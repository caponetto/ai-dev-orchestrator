import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunManifest, RunResult } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { resumeOrchestrator } from '../../composition-root';
import { ExitCode } from '../../output/exit-codes';
import type { OutputFormatter } from '../../output/formatter';
import { resumeCommand } from '../resume';

let mockRunsDir = '';
vi.mock('../../workspace-paths', () => ({
  getRunsDir: () => mockRunsDir,
  getRunDir: (runId: string) => join(mockRunsDir, runId),
  getStatePath: (runDir: string) => join(runDir, 'state.yaml'),
  getJournalPath: (runDir: string) => join(runDir, 'journal.md'),
}));

vi.mock('../../composition-root', () => ({
  resumeOrchestrator: vi.fn(),
}));

const mockResumeOrchestrator = vi.mocked(resumeOrchestrator);

function makeFormatter(): OutputFormatter & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: vi.fn((msg: string) => {
      messages.push(`INFO: ${msg}`);
    }),
    error: vi.fn((err: { code: number; message: string; remediation?: string }) => {
      messages.push(`ERROR: ${err.message}`);
      if (err.remediation) {
        messages.push(`REMEDIATION: ${err.remediation}`);
      }
    }),
    success: vi.fn((msg: string) => {
      messages.push(`SUCCESS: ${msg}`);
    }),
    summary: vi.fn(),
    startSpinner: vi.fn(),
    clearSpinner: vi.fn(),
    table: vi.fn(),
    json: vi.fn(),
  } as unknown as OutputFormatter & { messages: string[] };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cli-resume-test-${String(Date.now())}`);
  mkdirSync(testDir, { recursive: true });
  mockRunsDir = join(testDir, '.ai', 'runs');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('resumeCommand E2E', () => {
  beforeEach(() => {
    mockResumeOrchestrator.mockReset();
  });

  it('returns error when no interrupted run found', async () => {
    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      {
        runId: null,
        verbose: false,
        json: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No interrupted run found'))).toBe(true);
  });

  it('returns error when specified run directory does not exist', async () => {
    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      {
        runId: 'run-nonexistent-000000-abc123',
        verbose: false,
        json: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('Run directory not found'))).toBe(true);
  });

  it('returns error when run has no checkpoint', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, '.ai-config.yaml'), 'version: 1\n');

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      warnings: [],
      runId,
      runDir,
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      {
        runId,
        verbose: false,
        json: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No checkpoint found'))).toBe(true);
  });
});

describe('resumeCommand run discovery', () => {
  beforeEach(() => {
    mockResumeOrchestrator.mockReset();
  });

  it('discovers journal-only run when no checkpoint exists', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'journal.md'), 'some journal content\n');

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    await resumeCommand(testDir, { runId: null, verbose: false, json: false }, formatter);

    expect(formatter.messages.some((m) => m.includes('Resuming run'))).toBe(true);
    expect(formatter.messages.every((m) => !m.includes('No interrupted run found'))).toBe(true);
    expect(mockResumeOrchestrator).toHaveBeenCalledWith(testDir, runId);
  });

  it('prefers newer journal-only run over older checkpoint-backed run', async () => {
    const olderRunId = '20260701-100000-old111';
    const newerRunId = '20260703-120000-new222';
    const runsDir = join(testDir, '.ai', 'runs');

    const olderDir = join(runsDir, olderRunId);
    mkdirSync(olderDir, { recursive: true });
    writeFileSync(join(olderDir, 'state.yaml'), 'currentState: IMPLEMENTATION\n');

    const newerDir = join(runsDir, newerRunId);
    mkdirSync(newerDir, { recursive: true });
    writeFileSync(join(newerDir, 'journal.md'), 'some journal content\n');

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId: newerRunId,
      runDir: newerDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    await resumeCommand(testDir, { runId: null, verbose: false, json: false }, formatter);

    expect(mockResumeOrchestrator).toHaveBeenCalledWith(testDir, newerRunId);
  });

  it('skips terminal DONE runs during discovery', async () => {
    const doneRunId = '20260703-120000-done11';
    const activeRunId = '20260701-100000-active';
    const runsDir = join(testDir, '.ai', 'runs');

    const doneDir = join(runsDir, doneRunId);
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, 'state.yaml'), 'currentState: DONE\nschemaVersion: 2\n');

    const activeDir = join(runsDir, activeRunId);
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(join(activeDir, 'state.yaml'), 'currentState: IMPLEMENTATION\n');

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId: activeRunId,
      runDir: activeDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    await resumeCommand(testDir, { runId: null, verbose: false, json: false }, formatter);

    expect(mockResumeOrchestrator).toHaveBeenCalledWith(testDir, activeRunId);
  });

  it('skips terminal ABORTED runs during discovery', async () => {
    const abortedRunId = '20260703-120000-abort1';
    const runsDir = join(testDir, '.ai', 'runs');

    const abortedDir = join(runsDir, abortedRunId);
    mkdirSync(abortedDir, { recursive: true });
    writeFileSync(join(abortedDir, 'state.yaml'), 'currentState: ABORTED\nschemaVersion: 2\n');

    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      { runId: null, verbose: false, json: false },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No interrupted run found'))).toBe(true);
  });

  it('skips journal-only DONE runs during discovery', async () => {
    const doneRunId = '20260703-120000-jdone1';
    const runsDir = join(testDir, '.ai', 'runs');

    const doneDir = join(runsDir, doneRunId);
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(
      join(doneDir, 'journal.md'),
      '```yaml\ntype: state_transition\ndata:\n  to: DONE\n```\n',
    );

    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      { runId: null, verbose: false, json: false },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No interrupted run found'))).toBe(true);
  });

  it('skips journal-only ABORTED runs during discovery', async () => {
    const abortedRunId = '20260703-120000-jabrt1';
    const runsDir = join(testDir, '.ai', 'runs');

    const abortedDir = join(runsDir, abortedRunId);
    mkdirSync(abortedDir, { recursive: true });
    writeFileSync(
      join(abortedDir, 'journal.md'),
      '```yaml\ntype: run_aborted\ndata:\n  reason: user requested\n```\n',
    );

    const formatter = makeFormatter();
    const code = await resumeCommand(
      testDir,
      { runId: null, verbose: false, json: false },
      formatter,
    );

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No interrupted run found'))).toBe(true);
  });

  it('selects journal-only non-terminal run over terminal journal-only run', async () => {
    const terminalRunId = '20260703-120000-jterm1';
    const activeRunId = '20260701-100000-jactv1';
    const runsDir = join(testDir, '.ai', 'runs');

    const terminalDir = join(runsDir, terminalRunId);
    mkdirSync(terminalDir, { recursive: true });
    writeFileSync(
      join(terminalDir, 'journal.md'),
      '```yaml\ntype: state_transition\ndata:\n  to: DONE\n```\n',
    );

    const activeDir = join(runsDir, activeRunId);
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(
      join(activeDir, 'journal.md'),
      '```yaml\ntype: state_transition\ndata:\n  to: IMPLEMENTATION\n```\n',
    );

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId: activeRunId,
      runDir: activeDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    await resumeCommand(testDir, { runId: null, verbose: false, json: false }, formatter);

    expect(mockResumeOrchestrator).toHaveBeenCalledWith(testDir, activeRunId);
  });
});

describe('resumeCommand gate handling', () => {
  beforeEach(() => {
    mockResumeOrchestrator.mockReset();
  });

  it('rejects resume when run is waiting for text input', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn(), getState: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue({
          runId,
          currentState: 'WAITING_FOR_HUMAN',
          waitingContext: {
            reason: 'clarification_needed',
            requiredInput: 'text',
            autoResumeSafe: false,
            requestingState: 'REFINEMENT',
            presentedArtifacts: [],
            waitingSince: '2026-01-01T00:00:00Z',
          },
        }),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(formatter.messages.some((m) => m.includes('waiting for text input'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('ai answer'))).toBe(true);
  });

  it('resumes approval gates normally', async () => {
    const runId = '20260703-120000-abc123';
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const resumeImpl = vi.fn().mockResolvedValue({
      runId,
      finalState: 'DONE',
      artifactInventory: [],
      manifest: {} as unknown as RunManifest,
    });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: resumeImpl, getState: vi.fn().mockReturnValue({}) } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue({
          runId,
          currentState: 'WAITING_FOR_HUMAN',
          waitingContext: {
            reason: 'verification_complete',
            requiredInput: 'approval',
            autoResumeSafe: true,
            requestingState: 'VERIFICATION',
            presentedArtifacts: [],
            waitingSince: '2026-01-01T00:00:00Z',
          },
        }),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(resumeImpl).toHaveBeenCalledWith({ type: 'approval', content: 'Resumed via CLI' });
  });
});

describe('resumeCommand journal reconstruction', () => {
  const runId = '20260703-120000-abc123';

  function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
    return {
      runId,
      finalState: 'DONE',
      artifactInventory: [],
      manifest: {} as unknown as RunManifest,
      ...overrides,
    };
  }

  it('falls back to journal reconstruction when checkpoint is missing', async () => {
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const resumeImpl = vi.fn().mockResolvedValue(makeRunResult());
    const reconstructedState = {
      runId,
      currentState: 'IMPLEMENTATION',
      schemaVersion: 2,
      previousState: 'PLAN_REVIEW',
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 3,
      stateHistory: ['INTAKE', 'PLANNING', 'PLAN_REVIEW', 'IMPLEMENTATION'],
      iterationCounts: {},
      judgeArbitrationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:00:00Z',
      persistenceVersion: 3,
      checksum: 'abc',
    };

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: resumeImpl } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(reconstructedState),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('reconstructed state from journal'))).toBe(
      true,
    );
    expect(formatter.messages.some((m) => m.includes('IMPLEMENTATION'))).toBe(true);
    expect(resumeImpl).toHaveBeenCalled();
  });

  it('falls back to journal reconstruction when checkpoint is corrupt', async () => {
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    const resumeImpl = vi.fn().mockResolvedValue(makeRunResult());
    const reconstructedState = {
      runId,
      currentState: 'PLANNING',
      schemaVersion: 2,
      previousState: 'INTAKE',
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 1,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      judgeArbitrationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:00:00Z',
      persistenceVersion: 1,
      checksum: 'sha256:abc',
    };

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: resumeImpl } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockImplementation(() => {
          throw new Error('corrupt state file');
        }),
        reconstructFromJournal: vi.fn().mockReturnValue(reconstructedState),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('Checkpoint corrupt'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('reconstructed state from journal'))).toBe(
      true,
    );
    expect(formatter.messages.some((m) => m.includes('PLANNING'))).toBe(true);
    expect(resumeImpl).toHaveBeenCalled();
  });

  it('returns error when both checkpoint and journal reconstruction fail', async () => {
    const runDir = join(testDir, '.ai', 'runs', runId);
    mkdirSync(runDir, { recursive: true });

    mockResumeOrchestrator.mockResolvedValue({
      engine: { resume: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: { readAll: () => [] } as never,
      statePersistence: {
        load: vi.fn().mockReturnValue(null),
        reconstructFromJournal: vi.fn().mockReturnValue(null),
      } as never,
      agentStreamBus: {} as never,
      liveRequestStore: {} as never,
      artifactStore: {} as never,
      runId,
      runDir,
      warnings: [],
    });

    const formatter = makeFormatter();
    const code = await resumeCommand(testDir, { runId, verbose: false, json: false }, formatter);

    expect(code).toBe(ExitCode.GENERAL_ERROR);
    expect(formatter.messages.some((m) => m.includes('No checkpoint found'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('no journal to reconstruct from'))).toBe(true);
  });
});
