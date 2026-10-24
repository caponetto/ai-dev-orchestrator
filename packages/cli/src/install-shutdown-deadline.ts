import type { Logger } from '@ai-dev-orchestrator/ports';
import type { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';

import { ExitCode } from './output/exit-codes';
import { OutputFormatter } from './output/formatter';

/** Enforce a CLI exit bound without inventing a checkpoint or releasing an active owner's lock. */
export function installShutdownDeadline(coordinator: ShutdownCoordinator, logger: Logger): void {
  coordinator.install(() => {
    const message =
      'Graceful shutdown timed out. Exiting with the last durable progress; inspect the run before recovery.';
    try {
      logger.error(message);
      new OutputFormatter({
        json: process.argv.includes('--json'),
        noColor: process.argv.includes('--no-color'),
      }).error({
        code: ExitCode.RUN_ABORTED,
        message,
        remediation: 'Inspect the run and external work before retrying.',
      });
    } finally {
      process.exit(ExitCode.RUN_ABORTED);
    }
  });
}
