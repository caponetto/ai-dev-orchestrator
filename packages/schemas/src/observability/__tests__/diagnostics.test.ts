import { describe, expect, it } from 'vitest';

import {
  configurationInspectionSchema,
  configurationIssueSchema,
  diagnosticEntrySchema,
  diagnosticReportSchema,
  diagnosticReportSummarySchema,
  diagnosticSeveritySchema,
  errorChainEntrySchema,
  failureAnalysisSchema,
  subsystemDiagnosticSchema,
} from '../diagnostics';

describe('diagnosticSeveritySchema', () => {
  it.each(['error', 'warning', 'info', 'hint'])('accepts "%s"', (val) => {
    expect(diagnosticSeveritySchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid severity', () => {
    expect(diagnosticSeveritySchema.safeParse('critical').success).toBe(false);
  });
});

describe('diagnosticEntrySchema', () => {
  it('validates a diagnostic entry', () => {
    const data = {
      severity: 'error',
      code: 'MISSING_ARTIFACT',
      message: 'Required artifact not found',
      subsystem: 'artifact_system',
      context: { stateId: 'IMPL' },
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(diagnosticEntrySchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional suggestion', () => {
    const data = {
      severity: 'warning',
      code: 'SLOW_TRANSITION',
      message: 'Transition took > 10s',
      subsystem: 'workflow_engine',
      context: {},
      timestamp: '2026-01-01T00:00:00Z',
      suggestion: 'Check model latency',
    };
    expect(diagnosticEntrySchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(diagnosticEntrySchema.safeParse({ severity: 'error' }).success).toBe(false);
  });
});

describe('diagnosticReportSummarySchema', () => {
  it('validates a summary', () => {
    const data = {
      totalEntries: 5,
      errorCount: 1,
      warningCount: 2,
      infoCount: 1,
      hintCount: 1,
      subsystemsAffected: ['artifact_system', 'workflow_engine'],
    };
    expect(diagnosticReportSummarySchema.safeParse(data).success).toBe(true);
  });
});

describe('errorChainEntrySchema', () => {
  it('validates an error chain entry', () => {
    const data = {
      source: 'artifact_system',
      code: 'DISK_FULL',
      message: 'No space left',
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(errorChainEntrySchema.safeParse(data).success).toBe(true);
  });
});

describe('failureAnalysisSchema', () => {
  it('validates a failure analysis', () => {
    const data = {
      runId: 'r-1',
      failedAt: '2026-01-01T00:05:00Z',
      failedState: 'IMPLEMENTATION',
      rootCause: 'Provider timeout',
      contributingFactors: ['High latency', 'Large input'],
      errorChain: [
        {
          source: 'provider',
          code: 'TIMEOUT',
          message: 'Request timed out',
          timestamp: '2026-01-01T00:05:00Z',
        },
      ],
      recommendation: 'Increase timeout or reduce input size',
    };
    expect(failureAnalysisSchema.safeParse(data).success).toBe(true);
  });
});

describe('configurationIssueSchema', () => {
  it('validates an issue', () => {
    const data = {
      severity: 'warning',
      path: 'governance.iterationLimits.maxReviewIterations',
      message: 'Value is very high',
      currentValue: 100,
    };
    expect(configurationIssueSchema.safeParse(data).success).toBe(true);
  });

  it('validates with expected value and suggestion', () => {
    const data = {
      severity: 'error',
      path: 'roles.assignments.architect.model',
      message: 'Model not found',
      currentValue: 'nonexistent-model',
      expectedValue: 'gpt-4',
      suggestion: 'Use a valid model name',
    };
    expect(configurationIssueSchema.safeParse(data).success).toBe(true);
  });
});

describe('configurationInspectionSchema', () => {
  it('validates a passing inspection', () => {
    const data = { valid: true, entries: [], checkedAt: '2026-01-01T00:00:00Z' };
    expect(configurationInspectionSchema.safeParse(data).success).toBe(true);
  });
});

describe('subsystemDiagnosticSchema', () => {
  it('validates a subsystem diagnostic', () => {
    const data = {
      subsystem: 'artifact_system',
      status: 'healthy',
      entries: [],
      metrics: { totalArtifacts: 10, averageSizeBytes: 1024 },
      checkedAt: '2026-01-01T00:00:00Z',
    };
    expect(subsystemDiagnosticSchema.safeParse(data).success).toBe(true);
  });
});

describe('diagnosticReportSchema', () => {
  it('validates a full diagnostic report', () => {
    const data = {
      generatedAt: '2026-01-01T00:00:00Z',
      runId: 'r-1',
      entries: [],
      summary: {
        totalEntries: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        hintCount: 0,
        subsystemsAffected: [],
      },
      failureAnalysis: null,
      configurationInspection: null,
      subsystemDiagnostics: [],
    };
    expect(diagnosticReportSchema.safeParse(data).success).toBe(true);
  });

  it('validates with null runId', () => {
    const data = {
      generatedAt: '2026-01-01T00:00:00Z',
      runId: null,
      entries: [],
      summary: {
        totalEntries: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        hintCount: 0,
        subsystemsAffected: [],
      },
      failureAnalysis: null,
      configurationInspection: null,
      subsystemDiagnostics: [],
    };
    expect(diagnosticReportSchema.safeParse(data).success).toBe(true);
  });
});
