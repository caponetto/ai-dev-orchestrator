import { RecoverableErrorBase } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { DashboardDataError } from '../dashboard-errors';

describe('DashboardDataError', () => {
  it('has correct code and message', () => {
    const error = new DashboardDataError('journal', 'file not found');
    expect(error.code).toBe('DASHBOARD_DATA_ERROR');
    expect(error.message).toBe('Dashboard data error in journal: file not found');
    expect(error.source).toBe('journal');
    expect(error.detail).toBe('file not found');
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(RecoverableErrorBase);
  });

  it('is an instance of RecoverableErrorBase', () => {
    const error = new DashboardDataError('state', 'read failed');
    expect(error).toBeInstanceOf(RecoverableErrorBase);
  });
});
