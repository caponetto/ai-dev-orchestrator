import type { WorkflowDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_WORKFLOW } from '../../../../test/fixtures/test-defaults';
import { WorkflowValidator } from '../workflow-validator';

function minimal(): WorkflowDefinition {
  return {
    name: 'test',
    version: '1.0',
    initialState: 'START',
    terminalStates: ['END'],
    states: {
      START: {
        type: 'action',
        description: 'begin',
        transitions: [
          {
            target: 'END',
            trigger: 'completion',
            guards: [],
            governanceRequired: false,
            priority: 1,
          },
        ],
      },
      END: {
        type: 'terminal',
        description: 'done',
        transitions: [],
      },
    },
  };
}

describe('WorkflowValidator', () => {
  const validator = new WorkflowValidator();

  it('default workflow passes all validation rules', () => {
    const result = validator.validate(TEST_WORKFLOW);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('minimal valid workflow passes', () => {
    const result = validator.validate(minimal());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('initial_state_exists — fails when initial state not in states', () => {
    const def = { ...minimal(), initialState: 'MISSING' };
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === 'initial_state_exists')).toBe(true);
  });

  it('terminal_states_exist — fails when terminal state not in states', () => {
    const def = { ...minimal(), terminalStates: ['MISSING'] };
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === 'terminal_states_exist')).toBe(true);
  });

  it('terminal_no_transitions — fails when terminal state has transitions', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        ...minimal().states,
        END: {
          type: 'terminal',
          description: 'done',
          transitions: [
            {
              target: 'START',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'terminal_no_transitions')).toBe(true);
  });

  it('valid_targets — fails when transition targets unknown state', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'NOWHERE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'valid_targets')).toBe(true);
  });

  it('valid_triggers — fails on unknown trigger', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'bad_trigger' as never,
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'valid_triggers')).toBe(true);
  });

  it('valid_guards — fails on unknown guard type', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [{ type: 'unknown_guard' as never, params: {} }],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'valid_guards')).toBe(true);
  });

  it('valid_actions — fails on unknown action type', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          entryActions: [{ type: 'bad_action' as never, params: {} }],
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'valid_actions')).toBe(true);
  });

  it('completeness — fails when non-terminal state has no transitions', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'START',
      terminalStates: ['END'],
      states: {
        START: { type: 'action', description: 'begin', transitions: [] },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'completeness')).toBe(true);
  });

  it('reachability — fails when state is unreachable from initial', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'START',
      terminalStates: ['END'],
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
        ISOLATED: {
          type: 'action',
          description: 'orphan',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'reachability')).toBe(true);
  });

  it('terminal_convergence — fails when state cannot reach terminal', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'START',
      terminalStates: ['END'],
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'LOOP',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        LOOP: {
          type: 'action',
          description: 'stuck',
          transitions: [
            {
              target: 'LOOP',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'terminal_convergence')).toBe(true);
  });

  it('no_orphans — fails when state is never referenced', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'START',
      terminalStates: ['END'],
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
        ORPHAN: {
          type: 'action',
          description: 'never referenced',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'no_orphans')).toBe(true);
  });

  it('determinism — fails on duplicate trigger+priority', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'determinism')).toBe(true);
  });

  it('determinism — passes with same trigger but different priority', () => {
    const def: WorkflowDefinition = {
      ...minimal(),
      states: {
        START: {
          type: 'action',
          description: 'begin',
          transitions: [
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
            {
              target: 'END',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 2,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.errors.some((e) => e.rule === 'determinism')).toBe(false);
  });

  it('parallel_well_formed — passes when no parallel states exist', () => {
    const result = validator.validate(minimal());
    expect(result.errors.some((e) => e.rule === 'parallel_well_formed')).toBe(false);
  });

  it('no_infinite_loops — warns on cycles without exit transitions', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['END'],
      states: {
        A: {
          type: 'action',
          description: 'a',
          transitions: [
            {
              target: 'B',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        B: {
          type: 'action',
          description: 'b',
          transitions: [
            {
              target: 'A',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.warnings.some((w) => w.rule === 'no_infinite_loops')).toBe(true);
  });

  it('no_infinite_loops — does not warn on cycles with exit transitions', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      version: '1.0',
      initialState: 'A',
      terminalStates: ['END'],
      states: {
        A: {
          type: 'action',
          description: 'a',
          transitions: [
            {
              target: 'B',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
            {
              target: 'END',
              trigger: 'failure',
              guards: [],
              governanceRequired: false,
              priority: 2,
            },
          ],
        },
        B: {
          type: 'action',
          description: 'b',
          transitions: [
            {
              target: 'A',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 1,
            },
          ],
        },
        END: { type: 'terminal', description: 'done', transitions: [] },
      },
    };
    const result = validator.validate(def);
    expect(result.warnings.some((w) => w.rule === 'no_infinite_loops')).toBe(false);
  });
});
