# @ai-dev-orchestrator/project-context

Persistent project knowledge store that accumulates context across runs, enabling agents to learn from past executions.

## Architecture Layer

**Domain** -- manages persistent project knowledge accumulation and retrieval.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Storage Location

Context is stored per-project at `~/.ai/projects/<hash>/` where `<hash>` is the first 16 hex characters of the SHA-256 hash of the project root path.

## Context Categories

| Category      | File               | Purpose                                                                 |
| ------------- | ------------------ | ----------------------------------------------------------------------- |
| `codebase`    | `codebase.json`    | Architecture, modules, patterns, and conventions discovered during runs |
| `run_history` | `run_history.json` | History of past runs with outcomes, compressed progressively            |
| `preferences` | `preferences.json` | Model calibration data, failure patterns, and project preferences       |

## API

```typescript
import { FilesystemProjectContextStore } from '@ai-dev-orchestrator/project-context';

const store = new FilesystemProjectContextStore('~/.ai');

// Initialize for a project
await store.initialize('/path/to/project');

// Read a specific category
const codebase = await store.read('codebase');

// Write updated context
await store.write('codebase', {
  category: 'codebase',
  content: {/* CodebaseContext */},
  lastUpdated: new Date().toISOString(),
});

// Query for prompt injection
const fragments = await store.query({
  categories: ['codebase', 'run_history'],
  maxTokens: 2000,
});
```

## File Format

All context files are JSON validated against Zod schemas from `@ai-dev-orchestrator/schemas`. Writes are atomic (write to `.tmp` then rename) to prevent corruption.

## Run History Compression

Run history uses progressive compression:

- **Last 5 runs**: Full detail
- **Runs 6–20**: Compressed (key findings and outcome only)
- **Runs 20+**: Dropped
