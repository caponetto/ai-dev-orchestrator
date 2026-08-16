import type { RunDirectoryInfo } from '@ai-orchestrator/schemas';

/**
 * Manages the runtime directory structure for orchestrator runs.
 *
 * @remarks
 * Runtime data lives in the global `~/.ai/runs/` directory.
 */
export interface RuntimeDirectoryManager {
  /** Get or create the runtime directory for a run. */
  getRunDirectory(runId: string): string;

  /** List all run directories with metadata. */
  listRuns(): readonly RunDirectoryInfo[];

  /** Remove a run directory. */
  removeRun(runId: string): void;

  /** Get the global runtime root path. */
  getRuntimeRoot(): string;
}
