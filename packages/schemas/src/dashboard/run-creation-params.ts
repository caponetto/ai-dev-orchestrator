import { z } from 'zod/v4';

import { projectSettingsViewSchema, settingsGovernanceSchema } from './dashboard-domain';

/** Persistable run configuration from the New Run page (roles, governance, runtime). */
export const runSettingsSchema = z.object({
  roles: projectSettingsViewSchema.shape.roles.optional(),
  governance: settingsGovernanceSchema.optional(),
  runtime: projectSettingsViewSchema.shape.runtime.optional(),
});
export type RunSettings = z.infer<typeof runSettingsSchema>;

export const runCreationParamsSchema = z.object({
  prompt: z.string().min(1),
  workflow: z.string().optional(),
  repoRoot: z.string().optional(),
  runSettings: runSettingsSchema.optional(),
});
export type RunCreationParams = z.infer<typeof runCreationParamsSchema>;
