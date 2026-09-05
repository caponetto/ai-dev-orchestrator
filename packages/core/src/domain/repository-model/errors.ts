import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Global `~/.ai/` configuration directory is missing. */
export class RepositoryNotFoundError extends NonRecoverableErrorBase {
  readonly code = 'REPOSITORY_NOT_FOUND';

  constructor(readonly cwd: string) {
    super(`No ~/.ai/ directory found. Run 'ai init' to initialize. (cwd: ${cwd})`);
  }
}

/** Runtime directory (~/.ai/runs/) could not be created or accessed. */
export class RuntimeDirectoryError extends NonRecoverableErrorBase {
  readonly code = 'RUNTIME_DIRECTORY_ERROR';

  constructor(
    readonly dirPath: string,
    readonly cause: string,
  ) {
    super(`Runtime directory error at ${dirPath}: ${cause}`);
  }
}

/** A run directory is not writable (permissions issue). */
export class RunDirectoryNotWritableError extends NonRecoverableErrorBase {
  readonly code = 'RUN_DIRECTORY_NOT_WRITABLE';

  constructor(readonly dirPath: string) {
    super(`Run directory is not writable: ${dirPath}. Check disk permissions.`);
  }
}
