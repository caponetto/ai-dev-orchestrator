import { defineConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-dev-orchestrator/build-config';

export default defineConfig(
  createBaseTestConfig({ name: 'core:integration', useAliases: true, integrationOnly: true }),
);
