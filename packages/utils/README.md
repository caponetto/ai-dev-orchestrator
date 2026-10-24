# @ai-dev-orchestrator/utils

Shared low-level utilities for error handling, YAML parsing, content hashing, formatting, key conversion, type guards, and async timing helpers.

## Architecture Layer

**Foundation** -- shared utilities with no domain knowledge, used across all layers.

## Workspace Dependencies

None (only external dependency: `yaml`).

## Structure

```
src/
  __tests__/
```

## Key Exports

- `getErrorMessage` -- safe error-to-string extraction
- `formatBytes`, `formatDuration` -- human-readable formatting
- `hashContent` -- deterministic content hashing
- `parseYamlSafe`, `parseYamlAndNormalize` -- YAML parsing with error handling
- `camelToSnake`, `camelToSnakeDeep`, `snakeToCamel`, `snakeToCamelDeep` -- key converters
- `isObject`, `requireString`, `requireNumber`, `requireObject`, `requireStringArray` -- runtime type guards
- `raceWithTimeout`, `sleep` -- async timing helpers
- `FRONTMATTER_REGEX` -- frontmatter detection pattern

`OwnedProcess` is implemented and exported directly through
`@ai-dev-orchestrator/utils/owned-process`. Callers must explicitly opt into POSIX group ownership
only for a child they spawned detached. It provides idempotent TERM/KILL cleanup, a native-close
completion promise, deadline/timer cleanup and a shared parent-exit signal backstop. It never
infers group ownership or scans unrelated processes. This subpath adds no barrel re-export.
