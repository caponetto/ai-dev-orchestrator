import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { NamedGithubActionsReporter, shouldEmitJunit } from '@ai-dev-orchestrator/build-config';

const reporters: ('default' | 'junit' | 'blob' | NamedGithubActionsReporter)[] =
  process.env['GITHUB_ACTIONS'] === 'true'
    ? ['default', 'junit', 'blob', new NamedGithubActionsReporter()]
    : shouldEmitJunit()
      ? ['default', 'junit', 'blob']
      : ['default'];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    name: 'dashboard',
    reporters,
    outputFile: shouldEmitJunit()
      ? {
          junit: 'test-report.unit.junit.xml',
          // `pnpm coverage:merge` unions these blobs, so the filename must be unique per package.
          blob: '.vitest-reports/dashboard-unit.json',
        }
      : undefined,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    globals: false,
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/index.ts',
        'src/test/**',
        'src/components/ui/**',
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
