import type {
  AdaptiveConfig,
  ExecutionProfile,
  StaticConfigBaseline,
  WorkerOutcomeRecord,
} from '@ai-orchestrator/schemas';

export interface ExecutionAnalytics {
  recordOutcomes(outcomes: readonly WorkerOutcomeRecord[]): Promise<void>;
  getAdaptiveConfig(
    roleId: string,
    model: string,
    staticConfig: StaticConfigBaseline,
  ): Promise<AdaptiveConfig>;
  getProfile(roleId: string, model: string): Promise<ExecutionProfile | null>;
}
