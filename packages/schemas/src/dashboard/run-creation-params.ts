import { z } from 'zod/v4';

export const runCreationParamsSchema = z.object({
  prompt: z.string().min(1),
  workflow: z.string().optional(),
  repoRoot: z.string().optional(),
});
export type RunCreationParams = z.infer<typeof runCreationParamsSchema>;
