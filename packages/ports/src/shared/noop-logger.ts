import type { Logger } from '../contracts/logger.port';

/** Logger that silently discards all messages. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
