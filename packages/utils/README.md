# @ai-orchestrator/utils

Shared low-level utilities for error handling, YAML parsing, content hashing, formatting, key conversion, type guards, and async timing helpers.

## Architecture Layer

**Foundation** -- pure utility functions with no domain knowledge, used across all layers.

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
