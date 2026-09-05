import { defineConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-dev-orchestrator/build-config';

const base = createBaseTestConfig();

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    coverage: {
      ...base.test?.coverage,
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
