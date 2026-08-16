# @ai-orchestrator/code-intelligence

SCIP-powered code context for symbol-level PR review. Indexes TypeScript projects, maps diff hunks to symbols, and builds structured context that reviewers can use to understand cross-file impact.

## Architecture Layer

**Domain** -- provides symbol-level code analysis and context assembly.

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

- `ScipIndexer` -- generates SCIP indexes from TypeScript projects
- `ScipQueryEngine` -- queries symbol definitions, references, and relationships
- `DiffSymbolMapper` -- maps PR diff hunks to affected symbols
- `CodeContextBuilder` -- assembles symbol-level context for review prompts
