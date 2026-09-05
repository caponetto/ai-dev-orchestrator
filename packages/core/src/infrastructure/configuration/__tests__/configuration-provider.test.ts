import type { MergedConfiguration } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_BUILT_IN_DEFAULTS } from '../../../../test/fixtures/test-defaults';
import { FrozenConfigurationProvider, SourceTracker } from '../configuration-provider';

function createProvider(config?: Readonly<MergedConfiguration>): FrozenConfigurationProvider {
  const cfg = config ?? TEST_BUILT_IN_DEFAULTS;
  const tracker = new SourceTracker();
  tracker.record('workflow', 'project');
  tracker.record('roles', 'project');
  tracker.record('governance', 'project');
  tracker.record('runtime', 'project');
  return new FrozenConfigurationProvider(cfg, tracker);
}

describe('FrozenConfigurationProvider', () => {
  it('get() returns the full configuration', () => {
    const provider = createProvider();
    const config = provider.get();
    expect(config).toEqual(TEST_BUILT_IN_DEFAULTS);
  });

  it('getWorkflow() returns workflow section', () => {
    const provider = createProvider();
    expect(provider.getWorkflow()).toEqual(TEST_BUILT_IN_DEFAULTS.workflow);
  });

  it('getRoles() returns roles section', () => {
    const provider = createProvider();
    expect(provider.getRoles()).toEqual(TEST_BUILT_IN_DEFAULTS.roles);
  });

  it('getGovernance() returns governance section', () => {
    const provider = createProvider();
    expect(provider.getGovernance()).toEqual(TEST_BUILT_IN_DEFAULTS.governance);
  });

  it('getRuntime() returns runtime section', () => {
    const provider = createProvider();
    expect(provider.getRuntime()).toEqual(TEST_BUILT_IN_DEFAULTS.runtime);
  });

  it('getSource() returns project for tracked values', () => {
    const provider = createProvider();
    const source = provider.getSource('workflow');
    expect(source.origin).toBe('project');
  });

  it('getSource() returns default project origin for untracked paths', () => {
    const provider = createProvider();
    const source = provider.getSource('some.untracked.path');
    expect(source.origin).toBe('project');
    expect(source.fieldPath).toBe('some.untracked.path');
    expect(source.filePath).toBeUndefined();
  });

  it('works without an explicit tracker', () => {
    const provider = new FrozenConfigurationProvider(TEST_BUILT_IN_DEFAULTS);
    expect(provider.get()).toEqual(TEST_BUILT_IN_DEFAULTS);
    const source = provider.getSource('workflow');
    expect(source.origin).toBe('project');
    expect(source.fieldPath).toBe('workflow');
  });

  describe('reload', () => {
    it('replaces configuration after reload', () => {
      const provider = createProvider();
      expect(provider.getWorkflow().name).toBe('dev');

      const newConfig: MergedConfiguration = {
        ...TEST_BUILT_IN_DEFAULTS,
        workflow: { ...TEST_BUILT_IN_DEFAULTS.workflow, name: 'reloaded' },
      };

      provider.reload(newConfig);
      expect(provider.getWorkflow().name).toBe('reloaded');
      expect(provider.get().workflow.name).toBe('reloaded');
    });

    it('config remains accessible after reload', () => {
      const provider = createProvider();

      const newConfig: MergedConfiguration = {
        ...TEST_BUILT_IN_DEFAULTS,
        runtime: { ...TEST_BUILT_IN_DEFAULTS.runtime, logLevel: 'error' },
      };

      provider.reload(newConfig);

      expect(provider.getRuntime().logLevel).toBe('error');
      expect(provider.getRoles()).toEqual(TEST_BUILT_IN_DEFAULTS.roles);
      expect(provider.getGovernance()).toEqual(TEST_BUILT_IN_DEFAULTS.governance);
    });
  });
});
