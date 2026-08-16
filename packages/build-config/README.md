# @ai-orchestrator/build-config

Shared Vitest configuration and workspace aliases for the monorepo. Provides `createBaseTestConfig()` to generate consistent test settings (coverage thresholds, reporters, file patterns) across all packages.

## Architecture Layer

**Foundation** -- no workspace dependencies.

## Usage

```typescript
import { createBaseTestConfig } from '@ai-orchestrator/build-config';
import { defineConfig, mergeConfig } from 'vitest/config';

export default defineConfig(mergeConfig(createBaseTestConfig(), {/* overrides */}));
```
