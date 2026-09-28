import { defineConfig } from 'vitest/config';

/**
 * Config for `pnpm coverage:merge`, which runs `vitest --merge-reports` and therefore executes no
 * tests. It exists only because the root `vitest.workspace.ts` would otherwise be picked up and
 * Vitest would try to collect test files.
 *
 * The report paths in the merged lcov are relative to this config's directory, so it must stay at
 * the repository root or Codecov will receive unusable paths.
 *
 * `passWithNoTests` is required: Vitest also walks the normal test-collection path, finds nothing
 * because this config declares no `include`, and would otherwise exit 1 despite the merge having
 * already produced the report.
 */
export default defineConfig({ test: { name: 'merge', passWithNoTests: true } });
