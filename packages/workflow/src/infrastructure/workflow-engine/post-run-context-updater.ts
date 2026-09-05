import type { ProjectContextStore } from '@ai-dev-orchestrator/ports';
import type {
  CodebaseContext,
  ContextDocument,
  LearnedPreferences,
  ModelCalibrationEntry,
  RunHistory,
  RunHistoryEntry,
} from '@ai-dev-orchestrator/schemas';

const MAX_FULL_RUNS = 5;
const MAX_COMPRESSED_RUNS = 20;
const MAX_FAILURE_PATTERNS = 50;

export interface RunOutcomeParams {
  readonly runId: string;
  readonly workflowVariant: string;
  readonly taskSummary: string;
  readonly outcome: 'completed' | 'failed' | 'aborted' | 'escalated';
  readonly confidenceScore?: number;
  readonly modelUsed?: string;
  readonly keyFindings?: readonly string[];
}

export interface ModelEscalationParams {
  readonly roleId: string;
  readonly fromModel: string;
  readonly toModel: string;
  readonly confidenceScore: number;
}

export interface WorkerOutcome {
  readonly role: string;
  readonly model?: string;
  readonly success: boolean;
  readonly error?: string;
  readonly dispatches: number;
}

export interface CodebaseUpdateParams {
  readonly runId: string;
  readonly projectName: string;
  readonly projectStructure?: string;
  readonly conventions?: readonly string[];
  readonly existingPatterns?: readonly string[];
  readonly techStack?: readonly string[];
}

export class PostRunContextUpdater {
  private readonly store: ProjectContextStore;

  constructor(store: ProjectContextStore) {
    this.store = store;
  }

  async recordRunOutcome(params: RunOutcomeParams): Promise<void> {
    const existing = await this.store.read('run_history');
    const history: RunHistory = existing
      ? (existing.content as RunHistory)
      : { lastUpdated: new Date().toISOString(), runs: [] };

    const entry: RunHistoryEntry = {
      runId: params.runId,
      timestamp: new Date().toISOString(),
      workflowVariant: params.workflowVariant,
      taskSummary: params.taskSummary,
      outcome: params.outcome,
      compressed: false,
      ...(params.keyFindings ? { keyFindings: [...params.keyFindings] } : {}),
      ...(params.confidenceScore !== undefined ? { confidenceScore: params.confidenceScore } : {}),
      ...(params.modelUsed ? { modelUsed: params.modelUsed } : {}),
    };

    const allRuns = [...history.runs, entry];
    const compressedRuns = this.applyProgressiveCompression(allRuns);

    const doc: ContextDocument = {
      category: 'run_history',
      content: {
        lastUpdated: new Date().toISOString(),
        runs: compressedRuns,
      },
      lastUpdated: new Date().toISOString(),
      lastRunId: params.runId,
    };

    await this.store.write('run_history', doc);
  }

  async recordModelEscalation(params: ModelEscalationParams): Promise<void> {
    const existing = await this.store.read('preferences');
    const prefs: LearnedPreferences = existing
      ? (existing.content as LearnedPreferences)
      : {
          lastUpdated: new Date().toISOString(),
          modelCalibration: [],
          failurePatterns: [],
          projectPreferences: [],
        };

    const calibration = [...prefs.modelCalibration];
    const existingIdx = calibration.findIndex(
      (c) => c.roleId === params.roleId && c.model === params.fromModel,
    );

    if (existingIdx >= 0) {
      const existing = calibration[existingIdx];
      const newSampleSize = existing.sampleSize + 1;
      calibration[existingIdx] = {
        ...existing,
        escalationRate: (existing.escalationRate * existing.sampleSize + 1) / newSampleSize,
        avgConfidence:
          (existing.avgConfidence * existing.sampleSize + params.confidenceScore) / newSampleSize,
        sampleSize: newSampleSize,
      };
    } else {
      const newEntry: ModelCalibrationEntry = {
        roleId: params.roleId,
        model: params.fromModel,
        successRate: 0,
        avgConfidence: params.confidenceScore,
        escalationRate: 1,
        sampleSize: 1,
      };
      calibration.push(newEntry);
    }

    const doc: ContextDocument = {
      category: 'preferences',
      content: {
        ...prefs,
        lastUpdated: new Date().toISOString(),
        modelCalibration: calibration,
      },
      lastUpdated: new Date().toISOString(),
    };

    await this.store.write('preferences', doc);
  }

  async recordWorkerOutcomes(outcomes: readonly WorkerOutcome[], runId: string): Promise<void> {
    const existing = await this.store.read('preferences');
    const prefs: LearnedPreferences = existing
      ? (existing.content as LearnedPreferences)
      : {
          lastUpdated: new Date().toISOString(),
          modelCalibration: [],
          failurePatterns: [],
          projectPreferences: [],
        };

    const calibration = [...prefs.modelCalibration];
    for (const outcome of outcomes) {
      if (!outcome.model) {
        continue;
      }
      const idx = calibration.findIndex(
        (c) => c.roleId === outcome.role && c.model === outcome.model,
      );
      if (idx >= 0) {
        const entry = calibration[idx];
        const newSize = entry.sampleSize + outcome.dispatches;
        const successCount = outcome.success ? outcome.dispatches : 0;
        calibration[idx] = {
          ...entry,
          successRate: (entry.successRate * entry.sampleSize + successCount) / newSize,
          sampleSize: newSize,
        };
      } else {
        calibration.push({
          roleId: outcome.role,
          model: outcome.model,
          successRate: outcome.success ? 1 : 0,
          avgConfidence: 0,
          escalationRate: 0,
          sampleSize: outcome.dispatches,
        });
      }
    }

    const failurePatterns = [...prefs.failurePatterns];
    for (const outcome of outcomes) {
      if (outcome.success || !outcome.error) {
        continue;
      }
      const pattern = this.normalizeErrorPattern(outcome.error);
      const existingIdx = failurePatterns.findIndex((fp) => fp.pattern === pattern);
      if (existingIdx >= 0) {
        failurePatterns[existingIdx] = {
          ...failurePatterns[existingIdx],
          frequency: failurePatterns[existingIdx].frequency + 1,
          lastSeen: runId,
        };
      } else {
        failurePatterns.push({ pattern, frequency: 1, lastSeen: runId });
      }
    }

    failurePatterns.sort((a, b) => b.frequency - a.frequency);
    const trimmedPatterns = failurePatterns.slice(0, MAX_FAILURE_PATTERNS);

    const doc: ContextDocument = {
      category: 'preferences',
      content: {
        ...prefs,
        lastUpdated: new Date().toISOString(),
        modelCalibration: calibration,
        failurePatterns: trimmedPatterns,
      },
      lastUpdated: new Date().toISOString(),
      lastRunId: runId,
    };

    await this.store.write('preferences', doc);
  }

  async updateCodebaseContext(params: CodebaseUpdateParams): Promise<void> {
    const now = new Date().toISOString();

    const architectureParts: string[] = [];
    if (params.projectStructure) {
      architectureParts.push(params.projectStructure);
    }
    if (params.techStack && params.techStack.length > 0) {
      architectureParts.push(`Tech stack: ${params.techStack.join('; ')}`);
    }

    const context: CodebaseContext = {
      projectName: params.projectName,
      lastUpdated: now,
      lastRunId: params.runId,
      architecture: {
        summary: architectureParts.join('\n\n'),
        modules: [],
        patterns: (params.existingPatterns ?? []).map((p) => ({
          name: p.slice(0, 80),
          description: p,
          discoveredInRun: params.runId,
        })),
      },
      conventions: (params.conventions ?? []).map((c) => ({
        rule: c,
        evidence: 'Discovered by codebase analysis',
        discoveredInRun: params.runId,
      })),
    };

    const doc: ContextDocument = {
      category: 'codebase',
      content: context,
      lastUpdated: now,
      lastRunId: params.runId,
    };

    await this.store.write('codebase', doc);
  }

  private normalizeErrorPattern(error: string): string {
    return error
      .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
      .replace(/\/[\w/.-]+/g, '<path>')
      .slice(0, 200);
  }

  private applyProgressiveCompression(runs: RunHistoryEntry[]): RunHistoryEntry[] {
    if (runs.length <= MAX_FULL_RUNS) {
      return runs;
    }

    const recent = runs.slice(-MAX_FULL_RUNS);
    const older = runs.slice(0, -MAX_FULL_RUNS);

    const compressed = older.slice(-MAX_COMPRESSED_RUNS).map((run) =>
      run.compressed
        ? run
        : {
            runId: run.runId,
            timestamp: run.timestamp,
            workflowVariant: run.workflowVariant,
            taskSummary: run.taskSummary,
            outcome: run.outcome,
            compressed: true,
            ...(run.keyFindings ? { keyFindings: run.keyFindings } : {}),
          },
    );

    return [...compressed, ...recent];
  }
}
