import { z } from 'zod/v4';

export const successCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  verifiable: z.boolean(),
});

export type SuccessCriterion = z.infer<typeof successCriterionSchema>;

export const taskBriefSchema = z.object({
  what: z.string(),
  why: z.string(),
  how: z.string().optional(),
  successCriteria: z.array(successCriterionSchema).min(1),
});

export type TaskBrief = z.infer<typeof taskBriefSchema>;
