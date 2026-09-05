import type {
  CanonicalSpecification,
  CompletenessResult,
  SpecificationValidationResult,
} from '@ai-dev-orchestrator/schemas';

/** Port for validating canonical specifications (structure, semantics, and completeness). */
export interface SpecificationValidator {
  validateStructure(spec: CanonicalSpecification): SpecificationValidationResult;
  validateSemantics(spec: CanonicalSpecification): SpecificationValidationResult;
  validateCompleteness(spec: CanonicalSpecification): CompletenessResult;
}
