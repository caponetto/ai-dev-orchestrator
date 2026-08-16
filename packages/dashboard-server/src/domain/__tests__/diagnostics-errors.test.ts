import { RecoverableErrorBase } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  ConfigInspectionError,
  DiagnosticsError,
  FailureAnalysisError,
} from '../diagnostics-errors';

describe('DiagnosticsError', () => {
  it('has correct code and message', () => {
    const error = new DiagnosticsError('event-system', 'bus unresponsive');
    expect(error.code).toBe('DIAGNOSTICS_ERROR');
    expect(error.message).toBe('Diagnostics error in event-system: bus unresponsive');
    expect(error.subsystem).toBe('event-system');
    expect(error.detail).toBe('bus unresponsive');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(RecoverableErrorBase);
  });
});

describe('FailureAnalysisError', () => {
  it('has correct code and message', () => {
    const error = new FailureAnalysisError('run-1', 'no journal found');
    expect(error.code).toBe('FAILURE_ANALYSIS_ERROR');
    expect(error.message).toBe('Failure analysis error for run run-1: no journal found');
    expect(error.runId).toBe('run-1');
    expect(error.detail).toBe('no journal found');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(RecoverableErrorBase);
  });
});

describe('ConfigInspectionError', () => {
  it('has correct code and message', () => {
    const error = new ConfigInspectionError('missing provider key');
    expect(error.code).toBe('CONFIG_INSPECTION_ERROR');
    expect(error.message).toBe('Configuration inspection error: missing provider key');
    expect(error.detail).toBe('missing provider key');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(RecoverableErrorBase);
  });
});
