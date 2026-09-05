import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';

import type { Logger, LogLevel } from '@ai-dev-orchestrator/ports';

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

function formatLogLine(level: LogLevel, msg: string): string {
  return `${new Date().toISOString()} [${LEVEL_LABEL[level]}] ${msg}\n`;
}

export { noopLogger } from '@ai-dev-orchestrator/ports';

export function createLogger(minLevel: LogLevel, logFilePath?: string): Logger {
  const threshold = SEVERITY[minLevel];
  let fileStream: WriteStream | undefined;

  if (logFilePath) {
    try {
      fileStream = createWriteStream(logFilePath, { flags: 'a' });
      fileStream.on('error', () => {});
    } catch {
      // best-effort — don't crash if the log file path is invalid
    }
  }

  function emit(level: LogLevel, consoleFn: (msg: string) => void, msg: string): void {
    if (SEVERITY[level] < threshold) {
      return;
    }
    consoleFn(msg);
    fileStream?.write(formatLogLine(level, msg));
  }

  return {
    debug(msg: string) {
      emit('debug', console.debug, msg);
    },
    info(msg: string) {
      emit('info', console.info, msg);
    },
    warn(msg: string) {
      emit('warn', console.warn, msg);
    },
    error(msg: string) {
      emit('error', console.error, msg);
    },
  };
}
