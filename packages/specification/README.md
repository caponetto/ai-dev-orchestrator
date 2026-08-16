# @ai-orchestrator/specification

Specification validation, merging, and versioning for canonical project specifications. Ensures specifications conform to schema rules, resolves merge conflicts between versions, and manages the version chain.

## Architecture Layer

**Domain** -- defines the specification model and its invariants.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Key Exports

### Domain

- `COMPLETENESS_WEIGHTS` -- weights for specification completeness scoring
- `createSpecificationId` -- generates unique specification identifiers
- **Errors:** `SpecificationMergeConflictError`, `SpecificationSchemaError`, `SpecificationSemanticError`, `SpecificationVersionChainError`

### Infrastructure

- `DefaultSpecificationValidator` -- validates specifications against schema and semantic rules
- `DefaultSpecificationMerger` -- merges specification versions with conflict detection
- `serializeSpecification`, `deserializeSpecification` -- serialization helpers
- `createNextVersion` -- produces the next version in a specification chain
