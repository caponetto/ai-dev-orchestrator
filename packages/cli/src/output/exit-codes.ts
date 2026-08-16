import { getErrorMessage } from '@ai-orchestrator/utils';

/** Process exit codes following sysexits.h conventions where applicable. */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIGURATION_ERROR: 2,
  RUN_FAILED: 3,
  RUN_ABORTED: 4,
  HUMAN_REJECTED: 5,
  INVALID_ARGUMENTS: 64,
  NO_REPOSITORY: 66,
  LOCK_CONFLICT: 69,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface CLIError {
  readonly code: ExitCode;
  readonly message: string;
  readonly remediation: string;
  readonly detail?: unknown;
}

/** Map an error to the most specific exit code based on its class name. */
export function toExitCode(error: unknown): ExitCode {
  if (error instanceof Error) {
    const name = error.constructor.name;
    if (name.includes('Configuration') || name.includes('Schema') || name.includes('Validation')) {
      return ExitCode.CONFIGURATION_ERROR;
    }
    if (name.includes('Repository') || name === 'RepositoryNotFoundError') {
      return ExitCode.NO_REPOSITORY;
    }
    if (name.includes('Lock') || name === 'RunAlreadyActiveError') {
      return ExitCode.LOCK_CONFLICT;
    }
  }
  return ExitCode.GENERAL_ERROR;
}

/** Convert any thrown value into a structured CLI error with remediation guidance. */
export function toCLIError(error: unknown): CLIError {
  const code = toExitCode(error);
  const message = getErrorMessage(error);

  const remediations: Record<number, string> = {
    [ExitCode.CONFIGURATION_ERROR]: 'Check ~/.ai/ configuration files for syntax or schema errors.',
    [ExitCode.NO_REPOSITORY]:
      'Run `ai init` to create ~/.ai/, then run from within a git repository.',
    [ExitCode.LOCK_CONFLICT]: 'Another run is active. Use `ai resume` or wait for it to complete.',
    [ExitCode.RUN_ABORTED]: 'The run has been aborted. Check the journal for details.',
    [ExitCode.GENERAL_ERROR]: 'Check the error details above and try again.',
  };

  return {
    code,
    message,
    remediation: remediations[code],
    detail: error instanceof Error ? error.stack : undefined,
  };
}
