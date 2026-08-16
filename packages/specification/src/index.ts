// Domain — Canonical Specification
export {
  COMPLETENESS_WEIGHTS,
  createSpecificationId,
  SpecificationMergeConflictError,
  SpecificationSchemaError,
  SpecificationSemanticError,
  SpecificationVersionChainError,
} from './domain/index';

// Infrastructure — Canonical Specification
export {
  DefaultSpecificationValidator,
  DefaultSpecificationMerger,
  serializeSpecification,
  deserializeSpecification,
  createNextVersion,
} from './infrastructure/index';
