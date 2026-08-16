import { z } from 'zod/v4';

import { artifactTypeSchema } from '../artifacts/artifact-system';

export const roleInteractionRelationshipSchema = z.enum(['produces_for', 'reviews', 'approves']);
export type RoleInteractionRelationship = z.infer<typeof roleInteractionRelationshipSchema>;

export const roleInteractionSchema = z.object({
  producerRole: z.string(),
  consumerRole: z.string(),
  artifactType: artifactTypeSchema,
  relationship: roleInteractionRelationshipSchema,
});
export type RoleInteraction = z.infer<typeof roleInteractionSchema>;

export const artifactFlowDefinitionSchema = z.object({
  artifactType: artifactTypeSchema,
  producedBy: z.string(),
  consumedBy: z.array(z.string()).readonly(),
  reviewedBy: z.array(z.string()).readonly(),
});
export type ArtifactFlowDefinition = z.infer<typeof artifactFlowDefinitionSchema>;

export const visibilityCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
});
export type VisibilityCheck = z.infer<typeof visibilityCheckSchema>;
