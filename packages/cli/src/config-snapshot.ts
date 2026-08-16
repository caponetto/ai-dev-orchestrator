import { z } from 'zod/v4';

export const configSnapshotWorkflowSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  globalTransitionLimit: z.number().optional(),
  budget: z.object({ maxTokensPerRun: z.number().optional() }).optional(),
});

export const configSnapshotSchema = z.object({
  repoRoot: z.string().optional(),
  sources: z.array(z.string()).readonly().optional(),
  workflow: configSnapshotWorkflowSchema.optional(),
  roles: z.record(z.string(), z.unknown()).optional(),
  governance: z.record(z.string(), z.unknown()).optional(),
  runtime: z.record(z.string(), z.unknown()).optional(),
});
export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;
