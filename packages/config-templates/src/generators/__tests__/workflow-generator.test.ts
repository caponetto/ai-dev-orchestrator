import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  generateWorkflowYaml,
  getAvailableWorkflowNames,
  getBuiltInWorkflowByName,
  getBuiltInWorkflows,
} from '../workflow-generator';

describe('workflow-generator', () => {
  describe('getAvailableWorkflowNames', () => {
    it('returns a non-empty sorted array', () => {
      const names = getAvailableWorkflowNames();
      expect(names.length).toBeGreaterThan(0);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('contains known workflow names', () => {
      const names = getAvailableWorkflowNames();
      expect(names).toContain('dev');
      expect(names).toContain('pr-review');
    });

    it('returns same results on consecutive calls', () => {
      expect(getAvailableWorkflowNames()).toEqual(getAvailableWorkflowNames());
    });
  });

  describe('generateWorkflowYaml', () => {
    it('generates valid YAML for each available workflow', () => {
      for (const name of getAvailableWorkflowNames()) {
        const yaml = generateWorkflowYaml(name);
        expect(() => parseYaml(yaml) as unknown).not.toThrow();
      }
    });

    it('each workflow has required top-level fields', () => {
      for (const name of getAvailableWorkflowNames()) {
        const parsed = parseYaml(generateWorkflowYaml(name)) as Record<string, unknown>;
        expect(parsed).toHaveProperty('name');
        expect(parsed).toHaveProperty('version');
        expect(parsed).toHaveProperty('initial_state');
        expect(parsed).toHaveProperty('terminal_states');
        expect(parsed).toHaveProperty('states');
      }
    });

    it('workflow name in YAML matches requested name', () => {
      for (const name of getAvailableWorkflowNames()) {
        const parsed = parseYaml(generateWorkflowYaml(name)) as { name: string };
        expect(parsed.name).toBe(name);
      }
    });

    it('initial_state exists in states map', () => {
      for (const name of getAvailableWorkflowNames()) {
        const parsed = parseYaml(generateWorkflowYaml(name)) as {
          initial_state: string;
          states: Record<string, unknown>;
        };
        expect(parsed.states).toHaveProperty(parsed.initial_state);
      }
    });

    it('terminal_states all exist in states map', () => {
      for (const name of getAvailableWorkflowNames()) {
        const parsed = parseYaml(generateWorkflowYaml(name)) as {
          terminal_states: string[];
          states: Record<string, unknown>;
        };
        for (const ts of parsed.terminal_states) {
          expect(parsed.states).toHaveProperty(ts);
        }
      }
    });

    it('throws descriptive error for unknown workflow', () => {
      expect(() => generateWorkflowYaml('nonexistent_workflow')).toThrow(
        /Unknown workflow: nonexistent_workflow/,
      );
    });

    it('error message lists available workflows', () => {
      try {
        generateWorkflowYaml('nonexistent_workflow');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain('Available:');
        for (const name of getAvailableWorkflowNames()) {
          expect(msg).toContain(name);
        }
      }
    });
  });

  describe('getBuiltInWorkflows', () => {
    it('returns a non-empty array of parsed workflow definitions', () => {
      const workflows = getBuiltInWorkflows();
      expect(workflows.length).toBeGreaterThan(0);
    });

    it('each workflow has name, version, initialState, and states', () => {
      const workflows = getBuiltInWorkflows();
      for (const wf of workflows) {
        expect(wf.name).toBeTruthy();
        expect(wf.version).toBeTruthy();
        expect(wf.initialState).toBeTruthy();
        expect(Object.keys(wf.states).length).toBeGreaterThan(0);
      }
    });

    it('covers all available workflow names', () => {
      const workflows = getBuiltInWorkflows();
      const loadedNames = workflows.map((w) => w.name).sort((a, b) => a.localeCompare(b));
      const available = getAvailableWorkflowNames();
      expect(loadedNames).toEqual(available);
    });
  });

  describe('getBuiltInWorkflowByName', () => {
    it('returns a workflow definition for known names', () => {
      for (const name of getAvailableWorkflowNames()) {
        const wf = getBuiltInWorkflowByName(name);
        expect(wf).not.toBeNull();
        expect(wf?.name).toBe(name);
      }
    });

    it('returns null for unknown workflow name', () => {
      expect(getBuiltInWorkflowByName('nonexistent')).toBeNull();
    });

    it('pr-review workflow has SETUP as initial state', () => {
      const wf = getBuiltInWorkflowByName('pr-review');
      expect(wf).not.toBeNull();
      expect(wf?.initialState).toBe('SETUP');
    });

    it('pr-review SETUP state uses run_script with setup-pr-repo.ts', () => {
      const wf = getBuiltInWorkflowByName('pr-review');
      expect(wf).not.toBeNull();
      const setup = wf?.states['SETUP'];
      expect(setup).toBeDefined();
      expect(setup?.type).toBe('action');
      const scriptAction = setup?.entryActions?.find((a) => a.type === 'run_script');
      expect(scriptAction).toBeDefined();
      if (scriptAction?.type === 'run_script') {
        expect(scriptAction.params.script).toBe('setup-pr-repo.ts');
      }
    });

    it('pr-review CLEANUP state transitions to DONE on both success and failure', () => {
      const wf = getBuiltInWorkflowByName('pr-review');
      expect(wf).not.toBeNull();
      const cleanup = wf?.states['CLEANUP'];
      expect(cleanup).toBeDefined();
      const targets = cleanup?.transitions.map((t) => t.target);
      expect(targets).toEqual(['DONE', 'DONE']);
    });

    it('pr-review PUBLISH_FINDINGS transitions to CLEANUP', () => {
      const wf = getBuiltInWorkflowByName('pr-review');
      expect(wf).not.toBeNull();
      const publish = wf?.states['PUBLISH_FINDINGS'];
      expect(publish).toBeDefined();
      const completionTarget = publish?.transitions.find((t) => t.trigger === 'completion')?.target;
      expect(completionTarget).toBe('CLEANUP');
    });
  });
});
