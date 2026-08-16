import type { HealthChecker } from '@ai-orchestrator/ports';
import type {
  HealthCheckResult,
  HealthProbeConfig,
  SubsystemHealth,
} from '@ai-orchestrator/schemas';

import { HealthCheckFailedError } from '../domain/metrics-errors';

export class DefaultHealthChecker implements HealthChecker {
  private readonly probes = new Map<string, HealthProbeConfig>();
  private readonly history = new Map<string, HealthCheckResult[]>();

  registerProbe(probe: HealthProbeConfig): void {
    this.probes.set(probe.subsystem, probe);
    if (!this.history.has(probe.subsystem)) {
      this.history.set(probe.subsystem, []);
    }
  }

  async checkAll(): Promise<readonly HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    for (const probe of this.probes.values()) {
      const result = await this.runProbe(probe);
      results.push(result);
    }
    return results;
  }

  async checkSubsystem(subsystem: string): Promise<HealthCheckResult> {
    const probe = this.probes.get(subsystem);
    if (!probe) {
      return {
        subsystem,
        status: 'unknown',
        message: `No health probe registered for '${subsystem}'`,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        details: {},
      };
    }
    return this.runProbe(probe);
  }

  getSubsystemHealth(): readonly SubsystemHealth[] {
    const results: SubsystemHealth[] = [];

    for (const [subsystem, checks] of this.history) {
      const latest = checks[checks.length - 1];
      let consecutiveFailures = 0;
      for (let i = checks.length - 1; i >= 0; i--) {
        if (checks[i].status === 'unhealthy') {
          consecutiveFailures++;
        } else {
          break;
        }
      }

      results.push({
        subsystem,
        status: latest.status,
        lastCheckedAt: latest.checkedAt,
        consecutiveFailures,
        checks: checks.slice(-10),
      });
    }

    return results;
  }

  private async runProbe(probe: HealthProbeConfig): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const result = await probe.check();
      this.recordResult(probe.subsystem, result);
      return result;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      const result: HealthCheckResult = {
        subsystem: probe.subsystem,
        status: 'unhealthy',
        message: new HealthCheckFailedError(probe.subsystem, error.message).message,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        details: { error: error.message },
      };
      this.recordResult(probe.subsystem, result);
      return result;
    }
  }

  private recordResult(subsystem: string, result: HealthCheckResult): void {
    if (!this.history.has(subsystem)) {
      this.history.set(subsystem, []);
    }
    const checks = this.history.get(subsystem);
    if (!checks) {
      return;
    }
    checks.push(result);
    if (checks.length > 100) {
      checks.splice(0, checks.length - 100);
    }
  }
}
