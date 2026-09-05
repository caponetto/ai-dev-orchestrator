import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { JournalCorruptionError, JournalReadError, JournalWriteError } from '../errors';

describe('workflow journal errors', () => {
  it('JournalWriteError includes cause', () => {
    const error = new JournalWriteError('permission denied');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('JOURNAL_WRITE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('permission denied');
    expect(error.message).toContain('permission denied');
  });

  it('JournalReadError includes cause', () => {
    const error = new JournalReadError('file not found');
    expect(error.code).toBe('JOURNAL_READ_ERROR');
    expect(error.cause).toBe('file not found');
    expect(error.message).toContain('file not found');
  });

  it('JournalCorruptionError includes cause', () => {
    const error = new JournalCorruptionError('invalid YAML block');
    expect(error.code).toBe('JOURNAL_CORRUPTION_ERROR');
    expect(error.cause).toBe('invalid YAML block');
    expect(error.message).toContain('invalid YAML block');
  });

  it('all errors have correct name from constructor', () => {
    expect(new JournalWriteError('x').name).toBe('JournalWriteError');
    expect(new JournalReadError('x').name).toBe('JournalReadError');
    expect(new JournalCorruptionError('x').name).toBe('JournalCorruptionError');
  });
});
