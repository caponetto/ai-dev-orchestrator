import type { DiscoveryResult } from '@ai-dev-orchestrator/schemas';

/**
 * Discovers the target git repository from a working directory and the global
 * orchestrator config at `~/.ai/`.
 *
 * @remarks
 * Configuration is global-only (`~/.ai/`). Repository root is detected by
 * walking up from `cwd` looking for `.git/`.
 */
export interface RepositoryDiscovery {
  /** Discover the target repository from the current working directory. */
  discover(cwd: string): DiscoveryResult;
}
