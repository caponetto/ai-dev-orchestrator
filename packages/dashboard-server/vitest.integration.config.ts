import { defineConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-orchestrator/build-config';

export default defineConfig(
  createBaseTestConfig({
    name: 'dashboard-server:integration',
    useAliases: true,
    integrationOnly: true,
  }),
);
