import { z } from 'zod/v4';

export const criterionResultSchema = z.object({
  criterionId: z.string(),
  met: z.boolean(),
  evidence: z.string(),
});

export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const confidenceReportSchema = z.object({
  score: z.number().min(0).max(1),
  criteriaResults: z.array(criterionResultSchema),
  rationale: z.string(),
});

export type ConfidenceReport = z.infer<typeof confidenceReportSchema>;
