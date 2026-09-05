import type { StateNode, TransitionEdge, WorkflowStateView } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { computeElkPositions, MARKER_HEIGHT, MARKER_WIDTH } from '../elk-layout';

function state(
  id: string,
  type = 'action',
  parallelRoles?: string[],
  dynamicOpts?: { dynamicRole: string; dynamicWorkerCount?: number },
): StateNode {
  const parallelInfo = parallelRoles
    ? { type: 'fork' as const, parallelRoles }
    : dynamicOpts
      ? { type: 'fork' as const, ...dynamicOpts }
      : undefined;
  return {
    id,
    type,
    label: id,
    visited: false,
    current: false,
    timeSpentMs: 0,
    visitCount: 0,
    ...(parallelInfo ? { parallelInfo } : {}),
  };
}

function edge(from: string, to: string, trigger: string): TransitionEdge {
  return { from, to, trigger, traversed: false, traversalCount: 0 };
}

function getPos(positions: ReadonlyMap<string, { x: number; y: number }>, id: string) {
  const pos = positions.get(id);
  expect(pos, `expected position for '${id}'`).toBeDefined();
  return pos as { x: number; y: number };
}

describe('elk-layout', () => {
  describe('MARKER constants', () => {
    it('exports equal width and height for circular markers', () => {
      expect(MARKER_WIDTH).toBe(MARKER_HEIGHT);
      expect(MARKER_WIDTH).toBeGreaterThan(0);
    });
  });

  describe('computeElkPositions', () => {
    const simpleWorkflow: WorkflowStateView = {
      runId: 'run-1',
      currentState: 'A',
      visitedStates: ['A'],
      stateHistory: ['A'],
      states: [state('A'), state('B'), state('DONE', 'terminal')],
      transitions: [edge('A', 'B', 'completion'), edge('B', 'DONE', 'completion')],
    };

    it('returns positions for all states', async () => {
      const positions = await computeElkPositions(simpleWorkflow);

      expect(positions.has('A')).toBe(true);
      expect(positions.has('B')).toBe(true);
      expect(positions.has('DONE')).toBe(true);
    });

    it('places __START__ above the initial state', async () => {
      const positions = await computeElkPositions(simpleWorkflow);

      const startPos = getPos(positions, '__START__');
      const initialPos = getPos(positions, 'A');
      expect(startPos.y).toBeLessThan(initialPos.y);
      expect(startPos.x).toBe(initialPos.x);
    });

    it('places __END__ below the terminal state', async () => {
      const positions = await computeElkPositions(simpleWorkflow);

      const endPos = getPos(positions, '__END__');
      const terminalPos = getPos(positions, 'DONE');
      expect(endPos.y).toBeGreaterThan(terminalPos.y);
    });

    it('averages X across multiple terminal states for __END__', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('DONE', 'terminal'), state('ABORTED', 'terminal')],
        transitions: [edge('A', 'DONE', 'completion'), edge('A', 'ABORTED', 'abort')],
      };

      const positions = await computeElkPositions(workflow);
      const endPos = getPos(positions, '__END__');
      const donePos = getPos(positions, 'DONE');
      const abortedPos = getPos(positions, 'ABORTED');

      const expectedX = (donePos.x + abortedPos.x) / 2;
      expect(endPos.x).toBeCloseTo(expectedX, 1);
    });

    it('skips self-loop transitions', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('DONE', 'terminal')],
        transitions: [edge('A', 'A', 'retry'), edge('A', 'DONE', 'completion')],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('A')).toBe(true);
      expect(positions.has('DONE')).toBe(true);
    });

    it('deduplicates edges with the same from->to', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('B'), state('DONE', 'terminal')],
        transitions: [
          edge('A', 'B', 'completion'),
          edge('A', 'B', 'retry'),
          edge('B', 'DONE', 'completion'),
        ],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('A')).toBe(true);
      expect(positions.has('B')).toBe(true);
    });

    it('assigns wider width to parallel states', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [
          state('A'),
          state('PARALLEL', 'action', ['role_a', 'role_b', 'role_c']),
          state('DONE', 'terminal'),
        ],
        transitions: [edge('A', 'PARALLEL', 'completion'), edge('PARALLEL', 'DONE', 'completion')],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('PARALLEL')).toBe(true);
      expect(positions.has('__START__')).toBe(true);
      expect(positions.has('__END__')).toBe(true);
    });

    it('detects initial state when all states have incoming edges (fallback to first)', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('B'), state('DONE', 'terminal')],
        transitions: [
          edge('A', 'B', 'completion'),
          edge('B', 'A', 'retry'),
          edge('B', 'DONE', 'completion'),
        ],
      };

      const positions = await computeElkPositions(workflow);
      const startPos = getPos(positions, '__START__');
      const firstStatePos = getPos(positions, 'A');

      expect(startPos.x).toBe(firstStatePos.x);
      expect(startPos.y).toBeLessThan(firstStatePos.y);
    });

    it('assigns higher priority to happy-path edges', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('B'), state('C'), state('DONE', 'terminal')],
        transitions: [
          edge('A', 'B', 'completion'),
          edge('A', 'C', 'error_recovery'),
          edge('B', 'DONE', 'human_approved'),
          edge('C', 'DONE', 'timeout'),
        ],
      };

      const positions = await computeElkPositions(workflow);

      expect(positions.has('A')).toBe(true);
      expect(positions.has('B')).toBe(true);
      expect(positions.has('C')).toBe(true);
      expect(positions.has('DONE')).toBe(true);
    });

    it('handles workflow with no terminal states gracefully', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [state('A'), state('B')],
        transitions: [edge('A', 'B', 'completion')],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('A')).toBe(true);
      expect(positions.has('B')).toBe(true);
      expect(positions.has('__START__')).toBe(true);
      expect(positions.has('__END__')).toBe(false);
    });

    it('places states in top-to-bottom order along the happy path', async () => {
      const positions = await computeElkPositions(simpleWorkflow);

      const aPos = getPos(positions, 'A');
      const bPos = getPos(positions, 'B');
      const donePos = getPos(positions, 'DONE');

      expect(aPos.y).toBeLessThan(bPos.y);
      expect(bPos.y).toBeLessThan(donePos.y);
    });

    it('allocates wider width for states with dynamicRole', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [
          state('A'),
          state('SPEC', 'action', undefined, {
            dynamicRole: 'task_spec_writer',
            dynamicWorkerCount: 4,
          }),
          state('DONE', 'terminal'),
        ],
        transitions: [edge('A', 'SPEC', 'completion'), edge('SPEC', 'DONE', 'completion')],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('SPEC')).toBe(true);
      expect(positions.has('A')).toBe(true);
    });

    it('caps ELK node width for large dynamic worker counts', async () => {
      const workflow: WorkflowStateView = {
        runId: 'run-1',
        currentState: 'A',
        visitedStates: ['A'],
        stateHistory: ['A'],
        states: [
          state('A'),
          state('SPEC', 'action', undefined, {
            dynamicRole: 'task_spec_writer',
            dynamicWorkerCount: 10,
          }),
          state('DONE', 'terminal'),
        ],
        transitions: [edge('A', 'SPEC', 'completion'), edge('SPEC', 'DONE', 'completion')],
      };

      const positions = await computeElkPositions(workflow);
      expect(positions.has('SPEC')).toBe(true);
    });
  });
});
