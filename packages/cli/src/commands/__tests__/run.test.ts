import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { ExitCode } from '../../output/exit-codes';
import type { OutputFormatter } from '../../output/formatter';
import { runCommand } from '../run';

vi.mock('../../intake-router', () => ({
  resolveIntakeSources: vi.fn().mockReturnValue([
    {
      sourceMetadata: { fetchedAt: '', checksum: '' },
      rawFields: {},
      title: 'Test',
      description: 'Test body',
    },
  ]),
}));

const mockLiveRequestStore = vi.hoisted(() => ({
  listPendingRequests: vi.fn().mockResolvedValue([]),
  writeResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../composition-root', () => {
  const startMock = vi.fn();
  const resumeMock = vi.fn();
  const getStateMock = vi.fn().mockReturnValue({});
  const createRunConfigMock = vi.fn(
    (_runId: string, sources: readonly string[], workflow?: unknown) => ({
      runId: _runId,
      workflowDefinition: workflow ?? {},
      governancePolicy: {},
      roleAssignments: {},
      sources,
    }),
  );
  return {
    createOrchestrator: vi.fn(() =>
      Promise.resolve({
        engine: { start: startMock, resume: resumeMock, getState: getStateMock },
        journalWriter: {},
        journalReader: {},
        statePersistence: {},
        liveRequestStore: mockLiveRequestStore,
        artifactStore: { store: vi.fn().mockResolvedValue({ type: 'intake_requirements' }) },
        runId: '20260703-120000-test01',
        runDir: '/tmp/test-run',
        warnings: [],
      }),
    ),
    createRunConfig: createRunConfigMock,
    loadWorkflowFromConfig: vi.fn(() => null),
    loadWorkflowByName: vi.fn(() => null),
    __mocks: { startMock, resumeMock, getStateMock, createRunConfigMock },
  };
});

function makeFormatter(): OutputFormatter & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: vi.fn((msg: string) => {
      messages.push(`INFO: ${msg}`);
    }),
    error: vi.fn((err: { code: number; message: string }) => {
      messages.push(`ERROR: ${err.message}`);
    }),
    success: vi.fn((msg: string) => {
      messages.push(`SUCCESS: ${msg}`);
    }),
    warn: vi.fn((msg: string) => {
      messages.push(`WARN: ${msg}`);
    }),
    summary: vi.fn(),
    startSpinner: vi.fn(),
    clearSpinner: vi.fn(),
    table: vi.fn(),
    json: vi.fn(),
  } as unknown as OutputFormatter & { messages: string[] };
}

interface TestMocks {
  startMock: ReturnType<typeof vi.fn>;
  resumeMock: ReturnType<typeof vi.fn>;
  getStateMock: ReturnType<typeof vi.fn>;
  createRunConfigMock: ReturnType<typeof vi.fn>;
}

async function getMocks(): Promise<TestMocks> {
  const mod = (await import('../../composition-root')) as unknown as {
    __mocks: TestMocks;
  };
  return mod.__mocks;
}

async function getIntakeRouterMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = (await import('../../intake-router')) as unknown as {
    resolveIntakeSources: ReturnType<typeof vi.fn>;
  };
  return mod.resolveIntakeSources;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `cli-run-test-${String(Date.now())}`);
  mkdirSync(testDir, { recursive: true });
  const mocks = await getMocks();
  mocks.startMock.mockReset();
  mocks.resumeMock.mockReset();
  mocks.getStateMock.mockReset().mockReturnValue({});
  mocks.createRunConfigMock
    .mockReset()
    .mockImplementation((_runId: string, sources: readonly string[], workflow?: unknown) => ({
      runId: _runId,
      workflowDefinition: workflow ?? {},
      governancePolicy: {},
      roleAssignments: {},
      sources,
    }));
  mockLiveRequestStore.listPendingRequests.mockReset().mockResolvedValue([]);
  mockLiveRequestStore.writeResponse.mockReset().mockResolvedValue(undefined);
  const intakeRouter = await getIntakeRouterMock();
  intakeRouter.mockReset().mockReturnValue([
    {
      sourceMetadata: { fetchedAt: '', checksum: '' },
      rawFields: {},
      title: 'Test',
      description: 'Test body',
    },
  ]);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('runCommand', () => {
  it('returns INVALID_ARGUMENTS when no sources provided', async () => {
    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: [],

        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(formatter.messages.some((m) => m.includes('No input source'))).toBe(true);
  });

  it('returns SUCCESS on dry run with valid configuration', async () => {
    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: true,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('Dry run complete'))).toBe(true);
  });

  it('pauses at human gate and returns SUCCESS', async () => {
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'WAITING_FOR_HUMAN',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('paused at'))).toBe(true);
  });

  it('returns RUN_ABORTED when workflow aborts', async () => {
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'ABORTED',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_ABORTED);
  });

  it('returns RUN_FAILED when workflow reaches FAILED state', async () => {
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'FAILED',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_FAILED);
    expect(formatter.messages.some((m) => m.includes('process error'))).toBe(true);
  });

  it('returns RUN_FAILED when engine throws', async () => {
    const { startMock } = await getMocks();
    startMock.mockRejectedValueOnce(new Error('engine exploded'));

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.RUN_FAILED);
    expect(formatter.messages.some((m) => m.includes('engine exploded'))).toBe(true);
  });

  it('pauses at clarification wait and shows answer hint', async () => {
    const { startMock, getStateMock, resumeMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'WAITING_FOR_HUMAN',
      artifactInventory: [],
    });
    getStateMock.mockReturnValueOnce({
      waitingContext: {
        reason: 'clarification_needed',
        requiredInput: 'text',
        autoResumeSafe: false,
        requestingState: 'REFINEMENT',
        presentedArtifacts: [],
        waitingSince: '2026-01-01T00:00:00Z',
      },
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      {
        sources: ['Add user notification preferences'],
        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(resumeMock).not.toHaveBeenCalled();
    expect(
      formatter.messages.some(
        (m) =>
          m.includes('ai answer') && m.includes('"your answer"') && !m.includes('--message-id'),
      ),
    ).toBe(true);
  });

  it('selects default workflow for text sources', async () => {
    const { startMock, createRunConfigMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      {
        sources: ['Add a feature'],

        verbose: false,
        json: false,
        dryRun: false,
      },
      formatter,
    );

    expect(createRunConfigMock).toHaveBeenCalledWith(
      '20260703-120000-test01',
      ['Add a feature'],
      expect.objectContaining({ name: 'dev' }),
      expect.objectContaining({
        maxTokens: 20_000_000,
        reportOutputPath: undefined,
      }),
    );
  });

  it('outputs actionable CLI hints for live requests in non-TTY mode', async () => {
    const { startMock } = await getMocks();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    mockLiveRequestStore.listPendingRequests.mockResolvedValue([
      {
        messageId: 'msg-perm-1',
        kind: 'permission',
        runId: '20260703-120000-test01',
        payload: { action: 'file_write', resource: '/src/foo.ts', riskLevel: 'medium' },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    /* eslint-disable @typescript-eslint/no-misused-promises */
    startMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              runId: '20260703-120000-test01',
              finalState: 'DONE',
              artifactInventory: [],
            });
          }, 1500);
        }),
    );
    /* eslint-enable @typescript-eslint/no-misused-promises */

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['Test prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });

    expect(formatter.messages.some((m) => m.includes('ai permit'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('--message-id msg-perm-1'))).toBe(true);
  });

  it('includes --message-id in non-TTY clarification hints', async () => {
    const { startMock } = await getMocks();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    mockLiveRequestStore.listPendingRequests.mockResolvedValue([
      {
        messageId: 'msg-clar-1',
        kind: 'clarification',
        runId: '20260703-120000-test01',
        payload: { question: 'Which database?' },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    /* eslint-disable @typescript-eslint/no-misused-promises */
    startMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              runId: '20260703-120000-test01',
              finalState: 'DONE',
              artifactInventory: [],
            });
          }, 1500);
        }),
    );
    /* eslint-enable @typescript-eslint/no-misused-promises */

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['Test prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });

    expect(formatter.messages.some((m) => m.includes('ai answer'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('--message-id msg-clar-1'))).toBe(true);
  });

  it('poller stopped guard prevents late callbacks after engine completes', async () => {
    const { startMock } = await getMocks();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    let callCount = 0;
    mockLiveRequestStore.listPendingRequests.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 50));
        return [
          {
            messageId: 'msg-late-1',
            kind: 'permission' as const,
            runId: '20260703-120000-test01',
            payload: { action: 'file_write', resource: '/src/foo.ts', riskLevel: 'medium' },
            requestedAt: '2026-01-01T00:00:00Z',
          },
        ];
      }
      return [];
    });

    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['Test prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });

    expect(formatter.messages.every((m) => !m.includes('msg-late-1'))).toBe(true);
  });

  it('returns CONFIGURATION_ERROR when createOrchestrator throws', async () => {
    const { createOrchestrator } = await import('../../composition-root');
    vi.mocked(createOrchestrator).mockRejectedValueOnce(new Error('bad config'));

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(code).toBe(ExitCode.CONFIGURATION_ERROR);
    expect(formatter.messages.some((m) => m.includes('bad config'))).toBe(true);
  });

  it('returns INVALID_ARGUMENTS when named workflow is not found', async () => {
    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false, workflow: 'nonexistent' },
      formatter,
    );

    expect(code).toBe(ExitCode.INVALID_ARGUMENTS);
    expect(formatter.messages.some((m) => m.includes('Unknown workflow'))).toBe(true);
  });

  it('returns SUCCESS and shows summary when workflow completes with DONE', async () => {
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [{ type: 'implementation', name: 'test' }],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      { sources: ['Build something'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('completed successfully'))).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.summary).toHaveBeenCalled();
  });

  it('displays warnings from orchestrator context', async () => {
    const { createOrchestrator } = await import('../../composition-root');
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    vi.mocked(createOrchestrator).mockResolvedValueOnce({
      engine: { start: startMock, resume: vi.fn(), getState: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: {} as never,
      statePersistence: {} as never,
      liveRequestStore: mockLiveRequestStore as never,
      artifactStore: { store: vi.fn().mockResolvedValue({ type: 'intake_requirements' }) } as never,
      agentStreamBus: {} as never,
      runId: '20260703-120000-test01',
      runDir: '/tmp/test-run',
      warnings: ['Token budget is low', 'Missing optional config'],
    });

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(formatter.messages.some((m) => m.includes('Token budget is low'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('Missing optional config'))).toBe(true);
  });

  it('uses named workflow when loadWorkflowByName returns one', async () => {
    const compositionRoot = await import('../../composition-root');
    vi.mocked(compositionRoot.loadWorkflowByName).mockReturnValueOnce({
      name: 'custom',
      version: '2.0',
      initialState: 'INTAKE',
      states: { INTAKE: { type: 'initial', transitions: [] } },
    } as never);

    const { startMock, createRunConfigMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false, workflow: 'custom' },
      formatter,
    );

    expect(createRunConfigMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ name: 'custom' }),
      expect.anything(),
    );
  });

  it('returns SUCCESS with summary for non-standard final states', async () => {
    const { startMock } = await getMocks();
    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'CUSTOM_STATE',
      artifactInventory: [{ type: 'plan', name: 'my-plan' }],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      { sources: ['Build something'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.summary).toHaveBeenCalledWith(
      expect.objectContaining({
        'Final State': 'CUSTOM_STATE',
        Artifacts: 1,
      }),
    );
  });

  it('warns when artifact store fails to register intake requirements', async () => {
    const { createOrchestrator } = await import('../../composition-root');
    const { startMock } = await getMocks();

    vi.mocked(createOrchestrator).mockResolvedValueOnce({
      engine: { start: startMock, resume: vi.fn(), getState: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: {} as never,
      statePersistence: {} as never,
      liveRequestStore: mockLiveRequestStore as never,
      artifactStore: { store: vi.fn().mockRejectedValue(new Error('store failed')) } as never,
      agentStreamBus: {} as never,
      runId: '20260703-120000-test01',
      runDir: '/tmp/test-run',
      warnings: [],
    });

    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(formatter.messages.some((m) => m.includes('Failed to register'))).toBe(true);
  });

  it('handles non-string payload fields in non-TTY permission requests', async () => {
    const { startMock } = await getMocks();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    mockLiveRequestStore.listPendingRequests.mockResolvedValue([
      {
        messageId: 'msg-perm-ns',
        kind: 'permission',
        runId: '20260703-120000-test01',
        payload: { action: 123, resource: null, riskLevel: undefined },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    /* eslint-disable @typescript-eslint/no-misused-promises */
    startMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              runId: '20260703-120000-test01',
              finalState: 'DONE',
              artifactInventory: [],
            });
          }, 1500);
        }),
    );
    /* eslint-enable @typescript-eslint/no-misused-promises */

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['Test prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });

    expect(formatter.messages.some((m) => m.includes('Permission requested: unknown'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('unknown risk'))).toBe(true);
  });

  it('handles non-string question in non-TTY clarification requests', async () => {
    const { startMock } = await getMocks();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    mockLiveRequestStore.listPendingRequests.mockResolvedValue([
      {
        messageId: 'msg-clar-ns',
        kind: 'clarification',
        runId: '20260703-120000-test01',
        payload: { question: 42 },
        requestedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    /* eslint-disable @typescript-eslint/no-misused-promises */
    startMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              runId: '20260703-120000-test01',
              finalState: 'DONE',
              artifactInventory: [],
            });
          }, 1500);
        }),
    );
    /* eslint-enable @typescript-eslint/no-misused-promises */

    const formatter = makeFormatter();
    await runCommand(
      testDir,
      { sources: ['Test prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });

    expect(formatter.messages.some((m) => m.includes('Clarification requested:'))).toBe(true);
    expect(formatter.messages.some((m) => m.includes('ai answer'))).toBe(true);
  });

  it('handles invalid config snapshot gracefully', async () => {
    const { createOrchestrator } = await import('../../composition-root');
    const { startMock } = await getMocks();

    const runDir = join(testDir, 'run-snapshot-test');
    mkdirSync(runDir, { recursive: true });

    // Write invalid config snapshot (valid JSON but not matching schema)
    writeFileSync(join(runDir, 'config-snapshot.json'), '"not-an-object"', 'utf8');

    vi.mocked(createOrchestrator).mockResolvedValueOnce({
      engine: { start: startMock, resume: vi.fn(), getState: vi.fn() } as never,
      journalWriter: {} as never,
      journalReader: {} as never,
      statePersistence: {} as never,
      liveRequestStore: mockLiveRequestStore as never,
      artifactStore: { store: vi.fn().mockResolvedValue({ type: 'intake_requirements' }) } as never,
      agentStreamBus: {} as never,
      runId: '20260703-120000-test01',
      runDir,
      warnings: [],
    });

    startMock.mockResolvedValueOnce({
      runId: '20260703-120000-test01',
      finalState: 'DONE',
      artifactInventory: [],
    });

    const formatter = makeFormatter();
    const code = await runCommand(
      testDir,
      { sources: ['prompt'], verbose: false, json: false, dryRun: false },
      formatter,
    );

    expect(code).toBe(ExitCode.SUCCESS);
    expect(formatter.messages.some((m) => m.includes('completed successfully'))).toBe(true);
  });
});
