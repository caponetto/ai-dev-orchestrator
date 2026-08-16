import { defineConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-orchestrator/build-config';

export default defineConfig(createBaseTestConfig({ useAliases: true, includeIntegration: true }));
