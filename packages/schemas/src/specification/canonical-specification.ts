import { z } from 'zod/v4';

import { readinessVerdictSchema, threeTierSeveritySchema } from '../shared/string-enums';

export const specificationIdSchema = z.string().brand('SpecificationId');
export type SpecificationId = z.infer<typeof specificationIdSchema>;

export const stakeholderSchema = z.object({
  name: z.string(),
  role: z.string(),
  interest: z.string(),
});
export type Stakeholder = z.infer<typeof stakeholderSchema>;

export const assumptionSchema = z.object({
  id: z.string(),
  description: z.string(),
  impact: threeTierSeveritySchema,
  validated: z.boolean(),
});
export type Assumption = z.infer<typeof assumptionSchema>;

export const constraintSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['technical', 'business', 'regulatory', 'timeline', 'resource']),
  source: z.string(),
});
export type Constraint = z.infer<typeof constraintSchema>;

export const requirementPrioritySchema = z.enum(['must', 'should', 'could', 'wont']);
export type RequirementPriority = z.infer<typeof requirementPrioritySchema>;

export const functionalRequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: requirementPrioritySchema,
  acceptanceCriteria: z.array(z.string()).readonly(),
  dependencies: z.array(z.string()).readonly().optional(),
});
export type FunctionalRequirement = z.infer<typeof functionalRequirementSchema>;

export const nfrCategorySchema = z.enum([
  'performance',
  'security',
  'reliability',
  'scalability',
  'usability',
  'maintainability',
  'compatibility',
  'other',
]);
export type NfrCategory = z.infer<typeof nfrCategorySchema>;

export const nonFunctionalRequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: nfrCategorySchema,
  metric: z.string().optional(),
  threshold: z.string().optional(),
});
export type NonFunctionalRequirement = z.infer<typeof nonFunctionalRequirementSchema>;

export const verificationMethodSchema = z.enum(['test', 'review', 'demo', 'analysis']);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const acceptanceCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  verificationMethod: verificationMethodSchema,
  requirementIds: z.array(z.string()).readonly(),
});
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

export const riskSchema = z.object({
  id: z.string(),
  description: z.string(),
  likelihood: threeTierSeveritySchema,
  impact: threeTierSeveritySchema,
  mitigation: z.string().optional(),
});
export type Risk = z.infer<typeof riskSchema>;

export const dependencySchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['internal', 'external']),
  status: z.enum(['available', 'pending', 'blocked']),
  owner: z.string().optional(),
});
export type Dependency = z.infer<typeof dependencySchema>;

export const sourceProvenanceSchema = z.object({
  fetchedAt: z.string(),
  checksum: z.string(),
  fieldsMapped: z.array(z.string()).readonly(),
});
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;

export const specificationAnalysisSchema = z.object({
  completenessScore: z.number(),
  ambiguityCount: z.number(),
  riskCount: z.number(),
  unvalidatedAssumptionCount: z.number(),
  readinessVerdict: readinessVerdictSchema,
  analystNotes: z.string().optional(),
});
export type SpecificationAnalysis = z.infer<typeof specificationAnalysisSchema>;

export const canonicalSpecificationSchema = z.object({
  id: specificationIdSchema,
  version: z.number(),
  previousVersion: z.string().optional(),
  title: z.string(),
  businessGoal: z.string(),
  stakeholders: z.array(stakeholderSchema).readonly(),
  assumptions: z.array(assumptionSchema).readonly(),
  constraints: z.array(constraintSchema).readonly(),
  functionalRequirements: z.array(functionalRequirementSchema).readonly(),
  nonFunctionalRequirements: z.array(nonFunctionalRequirementSchema).readonly(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).readonly(),
  risks: z.array(riskSchema).readonly(),
  dependencies: z.array(dependencySchema).readonly(),
  definitionOfDone: z.array(z.string()).readonly(),
  sources: z.array(sourceProvenanceSchema).readonly(),
  createdAt: z.string(),
  updatedAt: z.string(),
  extensions: z.record(z.string(), z.unknown()).optional(),
  analysis: specificationAnalysisSchema.optional(),
});
export type CanonicalSpecification = z.infer<typeof canonicalSpecificationSchema>;

export const specificationValidationErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
  rule: z.string(),
});
export type SpecificationValidationError = z.infer<typeof specificationValidationErrorSchema>;

export const specificationValidationWarningSchema = z.object({
  field: z.string(),
  message: z.string(),
  suggestion: z.string(),
});
export type SpecificationValidationWarning = z.infer<typeof specificationValidationWarningSchema>;

export const specificationValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(specificationValidationErrorSchema).readonly(),
  warnings: z.array(specificationValidationWarningSchema).readonly(),
});
export type SpecificationValidationResult = z.infer<typeof specificationValidationResultSchema>;

export const completenessResultSchema = z.object({
  score: z.number(),
  missingFields: z.array(z.string()).readonly(),
  emptyFields: z.array(z.string()).readonly(),
  fieldScores: z.record(z.string(), z.number()),
});
export type CompletenessResult = z.infer<typeof completenessResultSchema>;

export const mergeStrategySchema = z.object({
  scalarConflict: z.enum(['last-wins', 'first-wins', 'flag-conflict']),
  arrayMerge: z.enum(['union', 'concatenate']),
  deduplication: z.boolean(),
});
export type MergeStrategy = z.infer<typeof mergeStrategySchema>;

export const mergeConflictSchema = z.object({
  field: z.string(),
  values: z.array(z.object({ source: z.string(), value: z.string() })).readonly(),
  resolution: z.enum(['auto-resolved', 'flagged']),
  resolvedValue: z.string().optional(),
});
export type MergeConflict = z.infer<typeof mergeConflictSchema>;

export const mergeResultSchema = z.object({
  merged: canonicalSpecificationSchema,
  conflicts: z.array(mergeConflictSchema).readonly(),
});
export type MergeResult = z.infer<typeof mergeResultSchema>;

export const COMPLETENESS_WEIGHTS: Record<string, number> = {
  title: 0.05,
  businessGoal: 0.1,
  stakeholders: 0.05,
  assumptions: 0.1,
  constraints: 0.05,
  functionalRequirements: 0.25,
  nonFunctionalRequirements: 0.1,
  acceptanceCriteria: 0.15,
  risks: 0.05,
  dependencies: 0.05,
  definitionOfDone: 0.05,
};
