import { describe, expect, it } from 'vitest';

import { ExitCode, toCLIError, toExitCode } from '../exit-codes';

describe('ExitCode', () => {
  it('defines all required exit codes', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.CONFIGURATION_ERROR).toBe(2);
    expect(ExitCode.RUN_FAILED).toBe(3);
    expect(ExitCode.RUN_ABORTED).toBe(4);
    expect(ExitCode.HUMAN_REJECTED).toBe(5);
    expect(ExitCode.INVALID_ARGUMENTS).toBe(64);
    expect(ExitCode.NO_REPOSITORY).toBe(66);
    expect(ExitCode.LOCK_CONFLICT).toBe(69);
  });
});

describe('toExitCode', () => {
  it('returns CONFIGURATION_ERROR for configuration errors', () => {
    class ConfigurationLoadError extends Error {
      constructor() {
        super('bad config');
      }
    }
    expect(toExitCode(new ConfigurationLoadError())).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('returns NO_REPOSITORY for RepositoryNotFoundError', () => {
    class RepositoryNotFoundError extends Error {
      constructor() {
        super('not found');
      }
    }
    expect(toExitCode(new RepositoryNotFoundError())).toBe(ExitCode.NO_REPOSITORY);
  });

  it('returns LOCK_CONFLICT for RunAlreadyActiveError', () => {
    class RunAlreadyActiveError extends Error {
      constructor() {
        super('locked');
      }
    }
    expect(toExitCode(new RunAlreadyActiveError())).toBe(ExitCode.LOCK_CONFLICT);
  });

  it('returns GENERAL_ERROR for unknown errors', () => {
    expect(toExitCode(new Error('unknown'))).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR for non-Error values', () => {
    expect(toExitCode('string error')).toBe(ExitCode.GENERAL_ERROR);
  });
});

describe('toCLIError', () => {
  it('creates CLIError from Error', () => {
    const err = new Error('something failed');
    const cliError = toCLIError(err);
    expect(cliError.code).toBe(ExitCode.GENERAL_ERROR);
    expect(cliError.message).toBe('something failed');
    expect(cliError.remediation).toBeDefined();
    expect(cliError.detail).toBeDefined();
  });

  it('creates CLIError from string', () => {
    const cliError = toCLIError('oops');
    expect(cliError.code).toBe(ExitCode.GENERAL_ERROR);
    expect(cliError.message).toBe('oops');
  });

  it('includes remediation for configuration errors', () => {
    class SchemaValidationError extends Error {
      constructor() {
        super('invalid schema');
      }
    }
    const cliError = toCLIError(new SchemaValidationError());
    expect(cliError.code).toBe(ExitCode.CONFIGURATION_ERROR);
    expect(cliError.remediation).toContain('~/.ai/');
  });

  it('includes remediation for repository errors', () => {
    class RepositoryNotFoundError extends Error {
      constructor() {
        super('no repo');
      }
    }
    const cliError = toCLIError(new RepositoryNotFoundError());
    expect(cliError.code).toBe(ExitCode.NO_REPOSITORY);
    expect(cliError.remediation).toContain('ai init');
    expect(cliError.remediation).toContain('git repository');
  });

  it('includes remediation for lock conflicts', () => {
    class LockAcquisitionError extends Error {
      constructor() {
        super('locked');
      }
    }
    const cliError = toCLIError(new LockAcquisitionError());
    expect(cliError.code).toBe(ExitCode.LOCK_CONFLICT);
    expect(cliError.remediation).toContain('resume');
  });

  it('includes remediation for aborted runs', () => {
    class AbortError extends Error {
      constructor() {
        super('aborted');
      }
    }
    const cliError = toCLIError(new AbortError());
    expect(cliError.code).toBe(ExitCode.GENERAL_ERROR);
    // Direct mapping via remediations table for RUN_ABORTED exit code
    expect(cliError.remediation).toBeDefined();
  });
});

describe('toExitCode — extended mappings', () => {
  it('returns CONFIGURATION_ERROR for Validation errors', () => {
    class ValidationError extends Error {
      constructor() {
        super('invalid');
      }
    }
    expect(toExitCode(new ValidationError())).toBe(ExitCode.CONFIGURATION_ERROR);
  });

  it('returns CONFIGURATION_ERROR for SchemaValidation errors', () => {
    class SchemaValidationError extends Error {
      constructor() {
        super('schema fail');
      }
    }
    expect(toExitCode(new SchemaValidationError())).toBe(ExitCode.CONFIGURATION_ERROR);
  });
});
