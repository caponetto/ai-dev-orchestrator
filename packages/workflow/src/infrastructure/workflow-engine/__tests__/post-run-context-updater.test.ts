import type { ProjectContextStore } from '@ai-orchestrator/ports';
import { describe, expect, it, vi } from 'vitest';

import { PostRunContextUpdater } from '../post-run-context-updater';

function createMockStore(
  readResult: unknown = null,
): ProjectContextStore & { write: ReturnType<typeof vi.fn> } {
  return {
    initialize: vi.fn(),
    read: vi.fn().mockResolvedValue(readResult),
    write: vi.fn(),
    query: vi.fn(),
    getProjectHash: vi.fn().mockReturnValue('abc123'),
  };
}

describe('PostRunContextUpdater', () => {
  it('appends a run summary to run_history on successful completion', async () => {
    const mockStore = createMockStore();
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordRunOutcome({
      runId: 'run-001',
      workflowVariant: 'dev',
      taskSummary: 'Implemented login',
      outcome: 'completed',
    });

    expect(mockStore.write).toHaveBeenCalledWith(
      'run_history',
      expect.objectContaining({
        category: 'run_history',
      }),
    );
  });

  it('preserves optional run outcome metadata', async () => {
    const mockStore = createMockStore();
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordRunOutcome({
      runId: 'run-optional',
      workflowVariant: 'dev',
      taskSummary: 'Investigated a failure',
      outcome: 'failed',
      confidenceScore: 0,
      modelUsed: 'gpt-5',
      keyFindings: ['Missing fixture'],
    });

    const written = mockStore.write.mock.calls[0][1] as {
      content: { runs: Array<Record<string, unknown>> };
    };
    expect(written.content.runs[0]).toMatchObject({
      confidenceScore: 0,
      modelUsed: 'gpt-5',
      keyFindings: ['Missing fixture'],
    });
  });

  it('appends to existing run history', async () => {
    const existingHistory = {
      category: 'run_history' as const,
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: [
          {
            runId: 'run-000',
            timestamp: '2026-08-10T00:00:00Z',
            workflowVariant: 'dev',
            taskSummary: 'Previous run',
            outcome: 'completed',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    };

    const mockStore = createMockStore(existingHistory);
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordRunOutcome({
      runId: 'run-001',
      workflowVariant: 'dev',
      taskSummary: 'New run',
      outcome: 'completed',
    });

    const writeCall = mockStore.write.mock.calls[0];
    const written = writeCall[1] as { content: { runs: unknown[] } };
    expect(written.content.runs).toHaveLength(2);
  });

  it('applies progressive compression when runs exceed threshold', async () => {
    const existingRuns = Array.from({ length: 8 }, (_, i) => ({
      runId: `run-${String(i)}`,
      timestamp: '2026-08-10T00:00:00Z',
      workflowVariant: 'dev',
      taskSummary: `Run ${String(i)}`,
      outcome: 'completed' as const,
      compressed: false,
    }));

    const existingHistory = {
      category: 'run_history' as const,
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        runs: existingRuns,
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    };

    const mockStore = createMockStore(existingHistory);
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordRunOutcome({
      runId: 'run-new',
      workflowVariant: 'dev',
      taskSummary: 'New run',
      outcome: 'completed',
    });

    const writeCall = mockStore.write.mock.calls[0];
    const written = writeCall[1] as {
      content: { runs: Array<{ compressed: boolean }> };
    };
    const compressed = written.content.runs.filter((r) => r.compressed);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it('updates model calibration on model escalation event', async () => {
    const existingPrefs = {
      category: 'preferences' as const,
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [],
        failurePatterns: [],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    };

    const mockStore = createMockStore(existingPrefs);
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordModelEscalation({
      roleId: 'implementer',
      fromModel: 'claude-haiku-4-5-20251001',
      toModel: 'claude-sonnet-5',
      confidenceScore: 0.3,
    });

    expect(mockStore.write).toHaveBeenCalledWith(
      'preferences',
      expect.objectContaining({
        category: 'preferences',
      }),
    );

    const writeCall = mockStore.write.mock.calls[0];
    const written = writeCall[1] as {
      content: { modelCalibration: Array<{ roleId: string; sampleSize: number }> };
    };
    expect(written.content.modelCalibration).toHaveLength(1);
    expect(written.content.modelCalibration[0]?.roleId).toBe('implementer');
    expect(written.content.modelCalibration[0]?.sampleSize).toBe(1);
  });

  it('records worker outcomes to preferences with success rates', async () => {
    const mockStore = createMockStore();
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordWorkerOutcomes(
      [
        { role: 'static_reviewer', model: 'claude-sonnet-5', success: true, dispatches: 1 },
        {
          role: 'docs_reviewer',
          model: 'gpt-5.4-low',
          success: false,
          error: 'model not available',
          dispatches: 1,
        },
      ],
      'run-001',
    );

    expect(mockStore.write).toHaveBeenCalledWith('preferences', expect.objectContaining({}));
    const written = mockStore.write.mock.calls[0][1] as {
      content: {
        modelCalibration: Array<{ roleId: string; successRate: number }>;
        failurePatterns: Array<{ pattern: string; frequency: number }>;
      };
    };
    expect(written.content.modelCalibration).toHaveLength(2);
    const successful = written.content.modelCalibration.find((c) => c.roleId === 'static_reviewer');
    expect(successful?.successRate).toBe(1);
    const failed = written.content.modelCalibration.find((c) => c.roleId === 'docs_reviewer');
    expect(failed?.successRate).toBe(0);
    expect(written.content.failurePatterns).toHaveLength(1);
    expect(written.content.failurePatterns[0]?.pattern).toContain('model not available');
  });

  it('updates matching calibration and failure-pattern entries while skipping model-less outcomes', async () => {
    const mockStore = createMockStore({
      category: 'preferences' as const,
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [
          {
            roleId: 'reviewer',
            model: 'gpt-5',
            successRate: 0.5,
            avgConfidence: 0,
            escalationRate: 0,
            sampleSize: 2,
          },
        ],
        failurePatterns: [{ pattern: 'network unavailable', frequency: 2, lastSeen: 'run-old' }],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    });
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordWorkerOutcomes(
      [
        { role: 'reviewer', model: 'gpt-5', success: true, dispatches: 2 },
        {
          role: 'reviewer',
          model: 'gpt-5',
          success: false,
          error: 'network unavailable',
          dispatches: 1,
        },
        { role: 'orchestrator', success: false, dispatches: 1 },
      ],
      'run-new',
    );

    const written = mockStore.write.mock.calls[0][1] as {
      content: {
        modelCalibration: Array<{ sampleSize: number; successRate: number }>;
        failurePatterns: Array<{ frequency: number; lastSeen: string }>;
      };
    };
    expect(written.content.modelCalibration).toEqual([
      expect.objectContaining({ sampleSize: 5, successRate: 0.6 }),
    ]);
    expect(written.content.failurePatterns).toEqual([
      expect.objectContaining({ frequency: 3, lastSeen: 'run-new' }),
    ]);
  });

  it('writes codebase context with artifact content', async () => {
    const mockStore = createMockStore();
    const updater = new PostRunContextUpdater(mockStore);

    await updater.updateCodebaseContext({
      runId: 'run-001',
      projectName: 'my-project',
      projectStructure: 'Monorepo with packages/',
      conventions: ['Use kebab-case', 'No default exports'],
      existingPatterns: ['Hexagonal architecture pattern'],
      techStack: ['TypeScript 5.x', 'Vitest'],
    });

    expect(mockStore.write).toHaveBeenCalledWith('codebase', expect.objectContaining({}));
    const written = mockStore.write.mock.calls[0][1] as {
      category: string;
      content: {
        projectName: string;
        architecture: {
          summary: string;
          modules: unknown[];
          patterns: Array<{ name: string; description: string; discoveredInRun: string }>;
        };
        conventions: Array<{ rule: string; evidence: string; discoveredInRun: string }>;
      };
    };
    expect(written.category).toBe('codebase');
    expect(written.content.projectName).toBe('my-project');
    expect(written.content.architecture.summary).toContain('Monorepo with packages/');
    expect(written.content.architecture.summary).toContain('TypeScript 5.x');
    expect(written.content.architecture.modules).toEqual([]);
    expect(written.content.architecture.patterns).toHaveLength(1);
    expect(written.content.architecture.patterns[0]?.description).toBe(
      'Hexagonal architecture pattern',
    );
    expect(written.content.conventions).toHaveLength(2);
    expect(written.content.conventions[0]?.rule).toBe('Use kebab-case');
    expect(written.content.conventions[0]?.discoveredInRun).toBe('run-001');
  });

  it('writes codebase context with minimal params', async () => {
    const mockStore = createMockStore();
    const updater = new PostRunContextUpdater(mockStore);

    await updater.updateCodebaseContext({
      runId: 'run-001',
      projectName: 'my-project',
    });

    expect(mockStore.write).toHaveBeenCalledWith('codebase', expect.objectContaining({}));
    const written = mockStore.write.mock.calls[0][1] as {
      content: {
        architecture: { summary: string; patterns: unknown[] };
        conventions: unknown[];
      };
    };
    expect(written.content.architecture.summary).toBe('');
    expect(written.content.architecture.patterns).toEqual([]);
    expect(written.content.conventions).toEqual([]);
  });

  it('overwrites existing codebase context with fresh analysis', async () => {
    const existing = {
      category: 'codebase' as const,
      content: {
        projectName: 'existing-project',
        lastUpdated: '2026-08-10T00:00:00Z',
        lastRunId: 'run-000',
        architecture: { summary: 'old', modules: [], patterns: [] },
        conventions: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    };
    const mockStore = createMockStore(existing);
    const updater = new PostRunContextUpdater(mockStore);

    await updater.updateCodebaseContext({
      runId: 'run-001',
      projectName: 'my-project',
      projectStructure: 'New structure',
    });

    expect(mockStore.write).toHaveBeenCalledOnce();
    const written = mockStore.write.mock.calls[0][1] as {
      content: { architecture: { summary: string } };
    };
    expect(written.content.architecture.summary).toContain('New structure');
  });

  it('increments existing calibration entry on repeated escalation', async () => {
    const existingPrefs = {
      category: 'preferences' as const,
      content: {
        lastUpdated: '2026-08-10T00:00:00Z',
        modelCalibration: [
          {
            roleId: 'implementer',
            model: 'claude-haiku-4-5-20251001',
            successRate: 0.5,
            avgConfidence: 0.4,
            escalationRate: 0.5,
            sampleSize: 2,
          },
        ],
        failurePatterns: [],
        projectPreferences: [],
      },
      lastUpdated: '2026-08-10T00:00:00Z',
    };

    const mockStore = createMockStore(existingPrefs);
    const updater = new PostRunContextUpdater(mockStore);

    await updater.recordModelEscalation({
      roleId: 'implementer',
      fromModel: 'claude-haiku-4-5-20251001',
      toModel: 'claude-sonnet-5',
      confidenceScore: 0.3,
    });

    const writeCall = mockStore.write.mock.calls[0];
    const written = writeCall[1] as {
      content: { modelCalibration: Array<{ sampleSize: number }> };
    };
    expect(written.content.modelCalibration[0]?.sampleSize).toBe(3);
  });
});
