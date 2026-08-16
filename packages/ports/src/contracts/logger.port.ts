export type { LogLevel } from '@ai-orchestrator/schemas';

/**
 * Minimal structured logger port.
 *
 * Implementations gate output based on the configured minimum severity.
 */
export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}
