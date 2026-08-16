import { z } from 'zod/v4';

import { artifactRefSchema } from '../artifacts/artifact-system';
import { readinessVerdictSchema, threeTierSeveritySchema } from '../shared/string-enums';

import {
  canonicalSpecificationSchema,
  assumptionSchema,
  riskSchema,
  constraintSchema,
  dependencySchema,
} from './canonical-specification';

export const intakeVerdictSchema = readinessVerdictSchema;
export type IntakeVerdict = z.infer<typeof intakeVerdictSchema>;

export const sourceMetadataSchema = z.object({
  fetchedAt: z.string(),
  checksum: z.string(),
});
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export const intermediateRequirementsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  rawFields: z.record(z.string(), z.unknown()).optional(),
  sourceMetadata: sourceMetadataSchema,
});
export type IntermediateRequirements = z.infer<typeof intermediateRequirementsSchema>;

export const analystConfigSchema = z.object({
  readinessThreshold: z.number(),
  maxAmbiguities: z.number(),
  requireExplicitAssumptions: z.boolean(),
});
export type AnalystConfig = z.infer<typeof analystConfigSchema>;

export const intakeConfigSchema = z.object({
  analyst: analystConfigSchema,
});
export type IntakeConfig = z.infer<typeof intakeConfigSchema>;

export const intakeResultSchema = z.object({
  verdict: intakeVerdictSchema,
  artifacts: z.array(artifactRefSchema).readonly(),
});
export type IntakeResult = z.infer<typeof intakeResultSchema>;

export const ambiguitySeveritySchema = threeTierSeveritySchema;
export type AmbiguitySeverity = z.infer<typeof ambiguitySeveritySchema>;

export const ambiguitySchema = z.object({
  id: z.string(),
  field: z.string(),
  description: z.string(),
  severity: ambiguitySeveritySchema,
});
export type Ambiguity = z.infer<typeof ambiguitySchema>;

export const requirementsAnalysisSchema = z.object({
  completenessScore: z.number(),
  ambiguities: z.array(ambiguitySchema).readonly(),
  assumptions: z.array(assumptionSchema).readonly(),
  risks: z.array(riskSchema).readonly(),
  constraints: z.array(constraintSchema).readonly(),
  dependencies: z.array(dependencySchema).readonly(),
  missingInformation: z.array(z.string()).readonly(),
});
export type RequirementsAnalysis = z.infer<typeof requirementsAnalysisSchema>;

export const clarificationQuestionCategorySchema = z.enum([
  'ambiguity',
  'missing',
  'assumption',
  'risk',
  'constraint',
]);
export type ClarificationQuestionCategory = z.infer<typeof clarificationQuestionCategorySchema>;

export const clarificationQuestionSchema = z.object({
  id: z.string(),
  category: clarificationQuestionCategorySchema,
  question: z.string(),
  context: z.string(),
  suggestedDefault: z.string().optional(),
});
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;

export const analystInputSchema = z.object({
  specification: canonicalSpecificationSchema,
  config: analystConfigSchema,
});
export type AnalystInput = z.infer<typeof analystInputSchema>;

export const analystOutputSchema = z.object({
  verdict: intakeVerdictSchema,
  analysis: requirementsAnalysisSchema,
  questions: z.array(clarificationQuestionSchema).readonly().optional(),
});
export type AnalystOutput = z.infer<typeof analystOutputSchema>;

export const ambiguityResultSchema = z.object({
  ambiguities: z.array(ambiguitySchema).readonly(),
  isReady: z.boolean(),
});
export type AmbiguityResult = z.infer<typeof ambiguityResultSchema>;
