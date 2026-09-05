import type { DiagnosticEntry } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import type { DiagnosticsDataSources } from '../default-diagnostics-engine';
import { DefaultDiagnosticsEngine } from '../default-diagnostics-engine';

const NOW = '2025-01-15T10:00:00Z';

function makeSources(overrides: Partial<DiagnosticsDataSources> = {}): DiagnosticsDataSources {
  return {
    getFailureContext: () => null,
    getConfig: () => ({}),
    getConfigRules: () => [],
    getSubsystemEntries: () => [],
    getSubsystemMetrics: () => ({}),
    getSubsystemStatus: () => 'healthy',
    listSubsystems: () => ['event-system', 'artifact-system'],
    clock: () => NOW,
    ...overrides,
  };
}

const errorEntry: DiagnosticEntry = {
  severity: 'error',
  code: 'EVT_001',
  message: 'Bus overflow',
  subsystem: 'event-system',
  context: {},
  timestamp: NOW,
};

describe('DefaultDiagnosticsEngine', () => {
  it('returns error for missing failure context', () => {
    const engine = new DefaultDiagnosticsEngine(makeSources());
    const result = engine.analyzeFailure('run-x');
    expect(result.ok).toBe(false);
  });

  it('analyzes failure when context exists', () => {
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getFailureContext: () => ({
          runId: 'run-1',
          finalState: 'CODING',
          completedAt: NOW,
          events: [
            {
              type: 'error',
              timestamp: NOW,
              source: 'runner-system',
              code: 'ERR',
              message: 'fail',
            },
          ],
        }),
      }),
    );
    const result = engine.analyzeFailure('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runId).toBe('run-1');
      expect(result.value.rootCause).toBe('fail');
    }
  });

  it('inspects configuration', () => {
    const engine = new DefaultDiagnosticsEngine(makeSources());
    const result = engine.inspectConfiguration();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it('returns error for unknown subsystem', () => {
    const engine = new DefaultDiagnosticsEngine(makeSources());
    const result = engine.getSubsystemDiagnostics('unknown');
    expect(result.ok).toBe(false);
  });

  it('returns subsystem diagnostics', () => {
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getSubsystemEntries: () => [errorEntry],
        getSubsystemMetrics: () => ({ events: 100 }),
      }),
    );
    const result = engine.getSubsystemDiagnostics('event-system');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subsystem).toBe('event-system');
      expect(result.value.entries).toHaveLength(1);
      expect(result.value.metrics['events']).toBe(100);
    }
  });

  it('generates report without runId', () => {
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getSubsystemEntries: (s) => (s === 'event-system' ? [errorEntry] : []),
      }),
    );
    const result = engine.generateReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runId).toBeNull();
      expect(result.value.failureAnalysis).toBeNull();
      expect(result.value.configurationInspection).not.toBeNull();
      expect(result.value.subsystemDiagnostics).toHaveLength(2);
      expect(result.value.summary.totalEntries).toBe(1);
      expect(result.value.summary.errorCount).toBe(1);
    }
  });

  it('generates report with runId and failure analysis', () => {
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getFailureContext: () => ({
          runId: 'run-1',
          finalState: 'CODING',
          completedAt: NOW,
          events: [],
        }),
      }),
    );
    const result = engine.generateReport('run-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runId).toBe('run-1');
      expect(result.value.failureAnalysis).not.toBeNull();
      expect(result.value.failureAnalysis?.failedState).toBe('CODING');
    }
  });

  it('report summary counts severities correctly', () => {
    const warnEntry: DiagnosticEntry = {
      ...errorEntry,
      severity: 'warning',
      subsystem: 'artifact-system',
    };
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getSubsystemEntries: (s) => {
          if (s === 'event-system') {
            return [errorEntry];
          }
          if (s === 'artifact-system') {
            return [warnEntry];
          }
          return [];
        },
      }),
    );
    const result = engine.generateReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.errorCount).toBe(1);
      expect(result.value.summary.warningCount).toBe(1);
      expect(result.value.summary.subsystemsAffected).toHaveLength(2);
    }
  });

  it('report summary counts info severity entries', () => {
    const infoEntry: DiagnosticEntry = {
      ...errorEntry,
      severity: 'info',
      code: 'INF_001',
      message: 'System initialized',
    };
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getSubsystemEntries: (s) => (s === 'event-system' ? [infoEntry] : []),
      }),
    );
    const result = engine.generateReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.infoCount).toBe(1);
      expect(result.value.summary.errorCount).toBe(0);
      expect(result.value.summary.warningCount).toBe(0);
      expect(result.value.summary.hintCount).toBe(0);
    }
  });

  it('report summary counts hint severity entries', () => {
    const hintEntry: DiagnosticEntry = {
      ...errorEntry,
      severity: 'hint',
      code: 'HINT_001',
      message: 'Consider upgrading',
    };
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        getSubsystemEntries: (s) => (s === 'event-system' ? [hintEntry] : []),
      }),
    );
    const result = engine.generateReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.hintCount).toBe(1);
      expect(result.value.summary.errorCount).toBe(0);
      expect(result.value.summary.warningCount).toBe(0);
      expect(result.value.summary.infoCount).toBe(0);
    }
  });

  it('report summary counts all four severity levels in a mix', () => {
    const entries: DiagnosticEntry[] = [
      { ...errorEntry, severity: 'error', code: 'E1', message: 'Error occurred' },
      { ...errorEntry, severity: 'warning', code: 'W1', message: 'Watch out' },
      { ...errorEntry, severity: 'info', code: 'I1', message: 'FYI' },
      { ...errorEntry, severity: 'hint', code: 'H1', message: 'Tip' },
      { ...errorEntry, severity: 'info', code: 'I2', message: 'Another info' },
    ];
    const engine = new DefaultDiagnosticsEngine(
      makeSources({
        listSubsystems: () => ['event-system'],
        getSubsystemEntries: () => entries,
      }),
    );
    const result = engine.generateReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.totalEntries).toBe(5);
      expect(result.value.summary.errorCount).toBe(1);
      expect(result.value.summary.warningCount).toBe(1);
      expect(result.value.summary.infoCount).toBe(2);
      expect(result.value.summary.hintCount).toBe(1);
    }
  });
});
