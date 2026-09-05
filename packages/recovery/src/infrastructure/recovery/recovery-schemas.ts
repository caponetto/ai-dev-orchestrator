import { persistedStateSchema } from '@ai-dev-orchestrator/schemas';
import { z } from 'zod/v4';

export const recoveryScenarioSchema = z.enum([
  'clean_load',
  'crash_during_worker',
  'crash_during_transition',
  'provider_timeout',
  'invalid_structured_output',
  'partial_artifact',
  'interrupted_workflow',
  'concurrent_execution',
  'disk_full',
  'state_corruption',
  'network_partition',
]);
export type RecoveryScenario = z.infer<typeof recoveryScenarioSchema>;

export const recoveryResultSchema = z.object({
  scenario: recoveryScenarioSchema,
  recovered: z.boolean(),
  state: persistedStateSchema.nullable(),
  warnings: z.array(z.string()).readonly(),
  discardedWork: z.array(z.string()).readonly(),
});
export type RecoveryResult = z.infer<typeof recoveryResultSchema>;

export const shutdownStateSchema = z.object({
  requested: z.boolean(),
  reason: z.enum(['signal', 'timeout', 'abort']),
  requestedAt: z.string(),
});
export type ShutdownState = z.infer<typeof shutdownStateSchema>;

export const lockFileContentSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  runId: z.string(),
  hostname: z.string(),
});
export type LockFileContent = z.infer<typeof lockFileContentSchema>;
