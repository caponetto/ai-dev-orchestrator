import type { MergedConfiguration, RunnerDefinition } from '@ai-orchestrator/schemas';

/** Context required to load configuration. */
export interface LoadContext {
  /** Path to the global `~/.ai/` configuration directory. */
  readonly aiConfigDir: string;
  /** Optional runner registry for validating runner/model assignments. */
  readonly runnerRegistry?: readonly RunnerDefinition[];
}

/** A single validation issue found during configuration validation. */
export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  /** File path where the issue was found. */
  readonly file: string;
  /** Dot-separated config path (e.g., "roles.planner.model"). */
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

/** Result of configuration validation. */
export interface ValidationReport {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  /** Included only when valid is true. */
  readonly effectiveConfig?: MergedConfiguration;
}

/**
 * Loads and validates all orchestrator configuration from global `~/.ai/` files.
 *
 * @remarks
 * The loader reads configuration from `~/.ai/` YAML files, resolves environment
 * variables, validates the result, and returns a frozen configuration object.
 */
export interface ConfigurationLoader {
  /**
   * Load and validate all configuration.
   *
   * @param context - Paths to configuration sources
   * @returns The validated, frozen configuration
   * @throws ConfigurationLoadError if validation fails
   */
  load(context: LoadContext): MergedConfiguration;

  /**
   * Validate configuration without loading into the runtime.
   *
   * @param context - Paths to configuration sources
   * @returns A report containing all errors and warnings
   */
  validate(context: LoadContext): ValidationReport;
}
