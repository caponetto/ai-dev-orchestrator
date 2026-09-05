import { defineConfig, mergeConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-dev-orchestrator/build-config';

export default mergeConfig(
  defineConfig(createBaseTestConfig({ useAliases: true })),
  defineConfig({
    test: {
      coverage: {
        exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/static/scripts/*.ts'],
      },
    },
  }),
);
