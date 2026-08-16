# @ai-orchestrator/dependency-graph

Artifact dependency graph with impact analysis, staleness detection, and provenance tracking. Models relationships between artifacts so the orchestrator can determine what is affected when an artifact changes.

## Architecture Layer

**Domain** -- defines the core graph model and rules for how artifacts relate to and impact each other.

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

- `ArtifactTypeNotInGraphError` -- thrown when referencing an artifact type not registered in the graph
- `DependencyGraphCycleError` -- thrown when adding a dependency would create a cycle

### Infrastructure

- `DefaultDependencyGraph` -- directed acyclic graph of artifact dependencies
- `DefaultImpactAnalyzer` -- determines which artifacts are affected by a change
- `DefaultStalenessDetector` -- identifies artifacts that are out of date relative to their dependencies
- `InMemoryProvenanceTracker` -- tracks the origin and lineage of artifacts in memory
