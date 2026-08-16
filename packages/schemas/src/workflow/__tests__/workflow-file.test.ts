import { describe, expect, it } from 'vitest';

import { workflowSchema } from '../workflow-file';

describe('workflowSchema', () => {
  it('validates a minimal workflow file', () => {
    const data = {
      name: 'simple',
      version: '1.0.0',
      initialState: 'START',
      terminalStates: ['DONE'],
      states: {
        START: {
          type: 'action',
          description: 'Starting state',
          transitions: [{ target: 'DONE', trigger: 'completion' }],
        },
        DONE: {
          type: 'terminal',
        },
      },
    };
    expect(workflowSchema.safeParse(data).success).toBe(true);
  });

  it('validates a workflow with guards and actions', () => {
    const data = {
      name: 'standard',
      version: '2.0.0',
      initialState: 'SPECIFICATION',
      terminalStates: ['DONE', 'ABORTED'],
      states: {
        SPECIFICATION: {
          type: 'action',
          label: 'Specification',
          description: 'Gather requirements',
          entryActions: [{ type: 'dispatch_worker', params: { role: 'architect' } }],
          transitions: [
            {
              target: 'IMPLEMENTATION',
              trigger: 'completion',
              guards: [
                { type: 'artifact_exists', params: { artifactType: 'canonical_specification' } },
              ],
              governanceRequired: true,
              priority: 0,
            },
          ],
        },
        IMPLEMENTATION: {
          type: 'action',
          description: 'Implement the feature',
          transitions: [{ target: 'DONE', trigger: 'completion' }],
        },
        DONE: { type: 'terminal', description: 'Completed' },
        ABORTED: { type: 'terminal', description: 'Aborted' },
      },
    };
    expect(workflowSchema.safeParse(data).success).toBe(true);
  });

  it('rejects empty name', () => {
    const data = {
      name: '',
      version: '1.0.0',
      initialState: 'S',
      terminalStates: ['S'],
      states: { S: { type: 'terminal' } },
    };
    expect(workflowSchema.safeParse(data).success).toBe(false);
  });

  it('rejects empty terminalStates', () => {
    const data = {
      name: 'test',
      version: '1.0.0',
      initialState: 'S',
      terminalStates: [],
      states: { S: { type: 'action' } },
    };
    expect(workflowSchema.safeParse(data).success).toBe(false);
  });

  it('applies defaults for optional transition fields', () => {
    const data = {
      name: 'defaults-test',
      version: '1.0.0',
      initialState: 'A',
      terminalStates: ['B'],
      states: {
        A: {
          type: 'action',
          transitions: [{ target: 'B', trigger: 'completion' }],
        },
        B: { type: 'terminal' },
      },
    };
    const result = workflowSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      const transition = result.data.states['A'].transitions[0];
      expect(transition.guards).toEqual([]);
      expect(transition.governanceRequired).toBe(false);
      expect(transition.priority).toBe(0);
    }
  });
});
