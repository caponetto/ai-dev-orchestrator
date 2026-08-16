import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { TEST_WORKFLOW } from '../../../../test/fixtures/test-defaults';
import { WorkflowParseError } from '../../../domain/workflow-dsl/errors';
import { WorkflowParser } from '../workflow-parser';

describe('WorkflowParser', () => {
  const parser = new WorkflowParser();

  it('parses the default workflow YAML without errors', () => {
    const yaml = stringify(TEST_WORKFLOW);
    const result = parser.parse(yaml);

    expect(result.name).toBe('dev');
    expect(result.version).toBe('1.0.0');
    expect(result.initialState).toBe('INTAKE');
    expect(result.terminalStates).toEqual(['DONE', 'ABORTED']);
    expect(Object.keys(result.states)).toHaveLength(12);
  });

  it('round-trips the default workflow through YAML', () => {
    const yaml = stringify(TEST_WORKFLOW);
    const parsed = parser.parse(yaml);

    expect(parsed.name).toBe(TEST_WORKFLOW.name);
    expect(parsed.version).toBe(TEST_WORKFLOW.version);
    expect(parsed.initialState).toBe(TEST_WORKFLOW.initialState);
    expect(parsed.terminalStates).toEqual(TEST_WORKFLOW.terminalStates);
    expect(Object.keys(parsed.states).sort()).toEqual(Object.keys(TEST_WORKFLOW.states).sort());

    for (const [stateId, state] of Object.entries(parsed.states)) {
      const original = TEST_WORKFLOW.states[stateId];
      expect(state.type).toBe(original.type);
      expect(state.transitions).toHaveLength(original.transitions.length);
    }
  });

  it('preserves entry actions through round-trip', () => {
    const yaml = stringify(TEST_WORKFLOW);
    const parsed = parser.parse(yaml);
    const intake = parsed.states['INTAKE'];
    const actions = intake.entryActions ?? [];
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('record_journal');
    expect(actions[1].type).toBe('dispatch_worker');
  });

  it('preserves guard params through round-trip', () => {
    const yaml = stringify(TEST_WORKFLOW);
    const parsed = parser.parse(yaml);
    const intake = parsed.states['INTAKE'];
    const firstTransition = intake.transitions[0];
    expect(firstTransition.guards).toHaveLength(1);
    expect(firstTransition.guards[0].type).toBe('artifact_exists');
    expect(firstTransition.guards[0].params['artifactType']).toBe('canonical_specification');
  });

  it('throws on empty input', () => {
    expect(() => parser.parse('')).toThrow(WorkflowParseError);
    expect(() => parser.parse('   ')).toThrow(WorkflowParseError);
  });

  it('throws on malformed YAML', () => {
    expect(() => parser.parse('{{{')).toThrow(WorkflowParseError);
  });

  it('throws on non-object YAML', () => {
    expect(() => parser.parse('- item1\n- item2')).toThrow(WorkflowParseError);
    expect(() => parser.parse('"just a string"')).toThrow(WorkflowParseError);
  });

  it('throws when name is missing', () => {
    const yaml = stringify({
      version: '1.0',
      initialState: 'A',
      terminalStates: ['B'],
      states: {},
    });
    expect(() => parser.parse(yaml)).toThrow('Missing required field "name"');
  });

  it('throws when initialState is missing', () => {
    const yaml = stringify({ name: 'test', version: '1.0', terminalStates: ['B'], states: {} });
    expect(() => parser.parse(yaml)).toThrow('Missing required field "initialState"');
  });

  it('throws when terminalStates is missing', () => {
    const yaml = stringify({ name: 'test', version: '1.0', initialState: 'A', states: {} });
    expect(() => parser.parse(yaml)).toThrow('Missing required field "terminalStates"');
  });

  it('throws when states is missing', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['B'],
    });
    expect(() => parser.parse(yaml)).toThrow('Missing required field "states"');
  });

  it('throws on invalid state type', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['A'],
      states: { A: { type: 'invalid', description: 'bad', transitions: [] } },
    });
    expect(() => parser.parse(yaml)).toThrow('invalid type "invalid"');
  });

  it('throws on invalid trigger', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['B'],
      states: {
        A: {
          type: 'action',
          description: 'test',
          transitions: [{ target: 'B', trigger: 'unknown_trigger', guards: [], priority: 1 }],
        },
        B: { type: 'terminal', description: 'end', transitions: [] },
      },
    });
    expect(() => parser.parse(yaml)).toThrow('invalid trigger');
  });

  it('throws on invalid guard type', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['B'],
      states: {
        A: {
          type: 'action',
          description: 'test',
          transitions: [
            {
              target: 'B',
              trigger: 'completion',
              guards: [{ type: 'bad_guard', params: {} }],
              priority: 1,
            },
          ],
        },
        B: { type: 'terminal', description: 'end', transitions: [] },
      },
    });
    expect(() => parser.parse(yaml)).toThrow('Unknown guard type');
  });

  it('throws on invalid action type', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['A'],
      states: {
        A: {
          type: 'terminal',
          description: 'test',
          entryActions: [{ type: 'bad_action', params: {} }],
          transitions: [],
        },
      },
    });
    expect(() => parser.parse(yaml)).toThrow('Unknown action type');
  });

  it('throws on invalid exit action type', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['A'],
      states: {
        A: {
          type: 'terminal',
          description: 'test',
          exitActions: [{ type: 'invalid_exit_action', params: {} }],
          transitions: [],
        },
      },
    });
    expect(() => parser.parse(yaml)).toThrow('Unknown action type');
  });

  it('throws when state value is not an object', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['A'],
      states: {
        A: 'not an object',
      },
    });
    expect(() => parser.parse(yaml)).toThrow('must be an object');
  });

  it('throws when terminalStates is empty array', () => {
    const yaml = stringify({
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: [],
      states: {
        A: { type: 'action', description: 'test', transitions: [] },
      },
    });
    expect(() => parser.parse(yaml)).toThrow(WorkflowParseError);
  });

  it('preserves exit actions through round-trip', () => {
    const workflowWithExitActions = {
      name: 'test-exit',
      version: '1.0.0',
      initialState: 'A',
      terminalStates: ['B'],
      states: {
        A: {
          type: 'action' as const,
          description: 'start state',
          entryActions: [{ type: 'record_journal' as const, params: { event: 'run_started' } }],
          exitActions: [{ type: 'record_journal' as const, params: { event: 'run_completed' } }],
          transitions: [
            {
              target: 'B',
              trigger: 'completion' as const,
              guards: [],
              priority: 1,
            },
          ],
        },
        B: {
          type: 'terminal' as const,
          description: 'end state',
          transitions: [],
        },
      },
    };
    const yaml = stringify(workflowWithExitActions);
    const parsed = parser.parse(yaml);
    const stateA = parsed.states['A'];
    expect(stateA.exitActions).toHaveLength(1);
    expect(stateA.exitActions?.[0].type).toBe('record_journal');
  });

  it('preserves state label through round-trip', () => {
    const workflowWithLabel = {
      name: 'test-label',
      version: '1.0.0',
      initialState: 'A',
      terminalStates: ['A'],
      states: {
        A: {
          type: 'terminal' as const,
          label: 'Final State',
          description: 'test',
          transitions: [],
        },
      },
    };
    const yaml = stringify(workflowWithLabel);
    const parsed = parser.parse(yaml);
    expect(parsed.states['A'].label).toBe('Final State');
  });
});
