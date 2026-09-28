# @ai-dev-orchestrator/build-config

Shared Vitest configuration and workspace aliases for the monorepo. Provides `createBaseTestConfig()` to generate consistent test settings (coverage thresholds, reporters, file patterns) across all packages.

## Architecture Layer

**Foundation** -- no workspace dependencies.

## Usage

```typescript
import { createBaseTestConfig } from '@ai-dev-orchestrator/build-config';
import { defineConfig, mergeConfig } from 'vitest/config';

export default defineConfig(mergeConfig(createBaseTestConfig(), {/* overrides */}));
```

## Test ownership

`createBaseTestConfig()` owns the split between `test:unit` and `test:integration`, and the two include patterns are disjoint by construction so no test is reported by both runs:

- default: `src/**/*.test.ts` plus, when `includeTestUnitDir` is set, `test/unit/**/*.test.ts`
- `integrationOnly`: `test/integration/**/*.test.ts`

`includeTestUnitDir` exists for packages that keep tests outside `src/`; `core` sets it because `test/unit/state-persistence-handlers.test.ts` is not a unit test that `test:integration` collects, and dropping it would silently lose coverage. `core` and `workflow` deliberately do **not** fold `test/integration` into their unit configs — doing so made every integration test run twice and double-count it in Codecov Test Analytics.

Integration configs write coverage to `coverage-integration/` so the two runs cannot overwrite each other's report, and they get their thresholds disabled because a suite that only covers part of a package would otherwise fail against package-wide thresholds. Both directories are for local inspection only; `pnpm coverage:merge` builds the Codecov report from the blob reporters via `vitest --merge-reports`, so the two runs do not need to write disjoint reports for the merge to be correct.

Each run also writes a blob to `.vitest-reports/<package>-<unit|integration>.json` when `CI=true`, embedding that run's coverage map. `vitest --merge-reports` unions them. The filename must include the package name because `--merge-reports` reads one flat directory and would otherwise find every package's `unit.json` overwriting the last.

## JUnit test results

When `CI=true`, `createBaseTestConfig()` adds a `junit` reporter alongside `default` and the GitHub Actions reporter, writing `test-report.unit.junit.xml` (or `test-report.integration.junit.xml` for `integrationOnly` configs) into the package root. `pnpm test:results:merge` combines those per-package reports into `test-results/junit.xml` for Codecov Test Analytics. Locally the reporter stays off, so nothing changes for `pnpm test:unit` or the pre-commit hook.
