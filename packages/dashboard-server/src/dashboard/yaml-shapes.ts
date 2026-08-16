/**
 * Zod schemas and derived types for the on-disk YAML shapes **after**
 * snake_case→camelCase conversion.
 *
 * These correspond to the YAML files produced by `ai init` and edited by the
 * dashboard.  Schemas use `.loose()` / `.catchall()` for forward compatibility
 * with unknown keys that may appear in user config files.
 */

import { z } from 'zod';

const roleEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    model: z.string().optional(),
    dispatchType: z.string().optional(),
    runner: z.string().optional(),
    ownedArtifacts: z.array(z.string()).optional(),
  })
  .loose();

export const rolesYamlShapeSchema = z
  .object({
    roles: z.array(roleEntrySchema).optional(),
  })
  .loose();

export type RolesYamlShape = z.infer<typeof rolesYamlShapeSchema>;

export const governanceYamlShapeSchema = z
  .object({
    iterationLimits: z
      .object({
        defaults: z.record(z.string(), z.number()).optional(),
        maxReviewIterations: z.number().optional(),
        maxJudgeArbitrations: z.number().optional(),
        maxClarificationRounds: z.number().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    qualityGates: z
      .object({
        specificationReadiness: z
          .object({ minCompletenessScore: z.number().optional() })
          .loose()
          .optional(),
        implementationReview: z
          .object({
            maxHighSeverityFindings: z.number().optional(),
            maxMediumSeverityFindings: z.number().optional(),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
    budget: z
      .object({
        maxTokensPerRun: z.union([z.number(), z.null()]).optional(),
      })
      .loose()
      .optional(),
    permissionPolicy: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type GovernanceYamlShape = z.infer<typeof governanceYamlShapeSchema>;

export const configYamlShapeSchema = z
  .object({
    logLevel: z.string().optional(),
    defaultWorkflow: z.string().optional(),
    workflowVersion: z.string().optional(),
    globalTransitionLimit: z.number().optional(),
    runtimeRoot: z.string().optional(),
    reportOutputPath: z.string().optional(),
  })
  .loose();

export type ConfigYamlShape = z.infer<typeof configYamlShapeSchema>;
