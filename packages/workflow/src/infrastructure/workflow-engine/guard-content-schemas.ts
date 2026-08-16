import { z } from 'zod/v4';

/**
 * Minimal (`.loose()`) schemas for validating artifact content during guard
 * evaluation. Each schema requires only the fields the corresponding guard
 * actually inspects, so extra fields in the artifact do not cause failures.
 */

export const judgeGuardContentSchema = z.object({ planLevelIssue: z.boolean().optional() }).loose();

const reviewFindingGuardContentSchema = z
  .object({
    category: z.string().optional(),
    severity: z.string().optional(),
  })
  .loose();

export const reviewGuardContentSchema = z
  .object({ findings: z.array(reviewFindingGuardContentSchema).readonly() })
  .loose();

const verificationFailureGuardContentSchema = z
  .object({
    fixable: z.boolean(),
    relatedness: z.enum(['related', 'unrelated']).optional(),
  })
  .loose();

export const verificationPassedGuardContentSchema = z.object({ passed: z.boolean() }).loose();

export const verificationFailuresGuardContentSchema = z
  .object({ failures: z.array(verificationFailureGuardContentSchema).readonly() })
  .loose();

export const planGuardContentSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            taskId: z.string().min(1),
            description: z.string().min(1),
            files: z.array(z.string()).readonly(),
            dependencies: z.array(z.string()).readonly(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

export const specFeasibilityGuardContentSchema = z
  .object({
    feasibility: z.object({ feasible: z.boolean(), reason: z.string().optional() }).optional(),
  })
  .loose();

export const specClarificationGuardContentSchema = z
  .object({ clarificationNeeds: z.array(z.unknown()).readonly().optional() })
  .loose();

export const approvedGuardContentSchema = z.object({ approved: z.boolean() }).loose();

export const passedGuardContentSchema = z.object({ passed: z.boolean() }).loose();

export const triagePlanIssueGuardContentSchema = z.object({ planLevelIssue: z.boolean() }).loose();

export const triageNeedsHumanGuardContentSchema = z.object({ needsHuman: z.boolean() }).loose();
