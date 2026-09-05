import type {
  HealthCheckResult,
  HealthProbeConfig,
  SubsystemHealth,
} from '@ai-dev-orchestrator/schemas';

/** Runs health checks across subsystems. */
export interface HealthChecker {
  /** Register a health probe for a subsystem. */
  registerProbe(probe: HealthProbeConfig): void;

  /** Check health of all registered subsystems. */
  checkAll(): Promise<readonly HealthCheckResult[]>;

  /** Check health of a specific subsystem. */
  checkSubsystem(subsystem: string): Promise<HealthCheckResult>;

  /** Get aggregated health status for all subsystems. */
  getSubsystemHealth(): readonly SubsystemHealth[];
}
