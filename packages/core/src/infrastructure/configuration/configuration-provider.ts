import type { ConfigSource, ConfigurationProvider } from '@ai-dev-orchestrator/ports';
import type {
  GovernanceConfig,
  MergedConfiguration,
  RolesConfig,
  RuntimeConfig,
  WorkflowConfig,
} from '@ai-dev-orchestrator/schemas';

/** Tracks which configuration layer provided each value. */
class SourceTracker {
  private readonly sources = new Map<string, ConfigSource>();

  record(path: string, origin: ConfigSource['origin'], filePath?: string): void {
    this.sources.set(path, { origin, fieldPath: path, filePath });
  }

  getSource(path: string): ConfigSource {
    return this.sources.get(path) ?? { origin: 'project', fieldPath: path };
  }
}

/**
 * Provides typed, read-only access to the frozen merged configuration.
 *
 * @remarks
 * Instantiated once per run after configuration loading completes.
 * Supports reload to swap the frozen configuration at runtime.
 */
export class FrozenConfigurationProvider implements ConfigurationProvider {
  private config: Readonly<MergedConfiguration>;
  private tracker: SourceTracker;

  constructor(config: Readonly<MergedConfiguration>, tracker?: SourceTracker) {
    this.config = config;
    this.tracker = tracker ?? new SourceTracker();
  }

  /** Get the full merged configuration. */
  get(): Readonly<MergedConfiguration> {
    return this.config;
  }

  /** Get the workflow configuration section. */
  getWorkflow(): Readonly<WorkflowConfig> {
    return this.config.workflow;
  }

  /** Get the roles configuration section. */
  getRoles(): Readonly<RolesConfig> {
    return this.config.roles;
  }

  /** Get the governance configuration section. */
  getGovernance(): Readonly<GovernanceConfig> {
    return this.config.governance;
  }

  /** Get the runtime configuration section. */
  getRuntime(): Readonly<RuntimeConfig> {
    return this.config.runtime;
  }

  /**
   * Get the source of a specific configuration value.
   *
   * @param path - Dot-separated path (e.g., "roles.planner.model")
   * @returns The source information for the value at that path
   */
  getSource(path: string): ConfigSource {
    return this.tracker.getSource(path);
  }

  reload(config: Readonly<MergedConfiguration>): void {
    this.config = config;
    this.tracker = new SourceTracker();
  }
}

export { SourceTracker };
