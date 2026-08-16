import { z } from 'zod/v4';

export const discoveredRunStatusSchema = z.enum(['active', 'completed', 'aborted']);
export type DiscoveredRunStatus = z.infer<typeof discoveredRunStatusSchema>;

export const discoveryResultSchema = z.object({
  found: z.boolean(),
  repoRoot: z.string().optional(),
  aiConfigDir: z.string().optional(),
  gitRoot: z.string().optional(),
  errors: z.array(z.string()).readonly().optional(),
});
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

export const runDirectoryInfoSchema = z.object({
  runId: z.string(),
  path: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
  status: discoveredRunStatusSchema,
});
export type RunDirectoryInfo = z.infer<typeof runDirectoryInfoSchema>;
