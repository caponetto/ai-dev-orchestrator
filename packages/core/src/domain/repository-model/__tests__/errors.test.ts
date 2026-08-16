import { OrchestratorError } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import {
  RepositoryNotFoundError,
  RuntimeDirectoryError,
  RunDirectoryNotWritableError,
} from '../errors';

describe('Repository Model Errors', () => {
  it('RepositoryNotFoundError has correct code and message', () => {
    const error = new RepositoryNotFoundError('/path/to/cwd');
    expect(error.code).toBe('REPOSITORY_NOT_FOUND');
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('~/.ai/');
    expect(error.message).toContain('ai init');
    expect(error.message).toContain('/path/to/cwd');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('RuntimeDirectoryError has correct code and message', () => {
    const error = new RuntimeDirectoryError('/path/to/dir', 'ENOSPC');
    expect(error.code).toBe('RUNTIME_DIRECTORY_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('/path/to/dir');
    expect(error.message).toContain('ENOSPC');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('RunDirectoryNotWritableError has correct code and message', () => {
    const error = new RunDirectoryNotWritableError('/path/to/run');
    expect(error.code).toBe('RUN_DIRECTORY_NOT_WRITABLE');
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('/path/to/run');
    expect(error.message).toContain('permission');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('all errors have the correct name from constructor', () => {
    expect(new RepositoryNotFoundError('/a').name).toBe('RepositoryNotFoundError');
    expect(new RuntimeDirectoryError('/a', 'b').name).toBe('RuntimeDirectoryError');
    expect(new RunDirectoryNotWritableError('/a').name).toBe('RunDirectoryNotWritableError');
  });
});
