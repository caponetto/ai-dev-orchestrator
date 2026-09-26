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

const snapshotRoleAssignmentsSchema = z.object({
  assignments: z.record(z.string(), z.object({ model: z.string().min(1) })),
});

type ModelAssignment = { model: string; maxTokens?: number };

/** Keep a resumed run's model choices even when the global role config has changed. */
export function resolveRunModelAssignments(
  current: Readonly<Record<string, ModelAssignment>>,
  snapshot: ConfigSnapshot | null,
): Record<string, ModelAssignment> {
  const assignments = snapshotRoleAssignmentsSchema.safeParse(snapshot?.roles);
  if (!assignments.success) {
    return { ...current };
  }

  const resolved = { ...current };
  for (const [roleId, assignment] of Object.entries(assignments.data.assignments)) {
    resolved[roleId] = { ...resolved[roleId], model: assignment.model };
  }
  return resolved;
}
