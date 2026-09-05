import type {
  GovernanceConfig,
  MergedConfiguration,
  RolesConfig,
  RuntimeConfig,
  WorkflowConfig,
} from '@ai-dev-orchestrator/schemas';

/** Tracks where a configuration value originated. */
export interface ConfigSource {
  readonly origin: 'builtin' | 'global' | 'organization' | 'project';
  /** File path for global/project origins. */
  readonly filePath?: string;
  /** Dot-separated path (e.g., "roles.planner.model"). */
  readonly fieldPath: string;
}

/**
 * Provides typed, read-only access to the merged configuration.
 *
 * @remarks
 * Instantiated once per run after configuration loading completes.
 * All returned values are frozen (deeply immutable).
 */
export interface ConfigurationProvider {
  /** Get the full merged configuration. */
  get(): Readonly<MergedConfiguration>;

  /** Get the workflow configuration section. */
  getWorkflow(): Readonly<WorkflowConfig>;

  /** Get the roles configuration section. */
  getRoles(): Readonly<RolesConfig>;

  /** Get the governance configuration section. */
  getGovernance(): Readonly<GovernanceConfig>;

  /** Get the runtime configuration section. */
  getRuntime(): Readonly<RuntimeConfig>;

  /**
   * Get the source of a specific configuration value.
   *
   * @param path - Dot-separated path (e.g., "roles.planner.model")
   * @returns The source information for the value at that path
   */
  getSource(path: string): ConfigSource;

  /** Replace the current frozen configuration with a new one. */
  reload(config: Readonly<MergedConfiguration>): void;
}
