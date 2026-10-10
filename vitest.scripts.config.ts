import { defineConfig } from 'vitest/config';

// Inlined rather than imported from `build-config` so this config keeps no workspace dependency and
// stays loadable when `build-config`'s `dist` is stale. Turbo hashes `CI` via `globalEnv`, so
// toggling this is a cache miss rather than a stale-output replay.
const emitJunit = process.env['CI'] === 'true';

export default defineConfig({
  test: {
    name: 'scripts',
    include: ['scripts/**/__tests__/**/*.test.ts'],
    // Without this the script suite is invisible to Codecov Test Analytics: `merge-test-results.ts`
    // only discovers reports under `packages/`.
    reporters: emitJunit ? ['default', 'junit'] : ['default'],
    outputFile: emitJunit ? { junit: 'test-report.scripts.junit.xml' } : undefined,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage-scripts',
      include: ['scripts/**/*.ts'],
      exclude: [
        'scripts/**/*.test.ts',
        'scripts/**/__tests__/**',
        // Thin wrappers that shell out to the installed Claude Code, Codex and OpenCode CLIs and run on import.
        'scripts/runner-models/{claude-code,codex,opencode}.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
