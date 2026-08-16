// @vitest-environment jsdom
import type { WorkflowStateView } from '@ai-orchestrator/schemas';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowGraph } from '../WorkflowGraph';

const fitViewMock = vi.fn();

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ControlButton: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div className="react-flow">{children}</div>
  ),
  useReactFlow: () => ({
    fitView: fitViewMock,
  }),
}));

vi.mock('../elk-layout', () => ({
  computeElkPositions: (workflow: WorkflowStateView) =>
    Promise.resolve(new Map(workflow.states.map((s, i) => [s.id, { x: 100, y: i * 100 }]))),
  MARKER_WIDTH: 30,
  MARKER_HEIGHT: 30,
}));

const workflow: WorkflowStateView = {
  runId: 'run-1',
  currentState: 'INTAKE',
  visitedStates: ['INTAKE'],
  stateHistory: ['INTAKE'],
  states: [
    {
      id: 'INTAKE',
      type: 'action',
      label: 'INTAKE',
      visited: true,
      current: true,
      timeSpentMs: 0,
      visitCount: 1,
    },
  ],
  transitions: [],
};

const refreshedWorkflow: WorkflowStateView = {
  ...workflow,
  currentState: 'DONE',
  visitedStates: ['INTAKE', 'DONE'],
  stateHistory: ['INTAKE', 'DONE'],
  states: [
    workflow.states[0],
    {
      id: 'DONE',
      type: 'terminal',
      label: 'DONE',
      visited: true,
      current: true,
      timeSpentMs: 1000,
      visitCount: 1,
    },
  ],
  transitions: [
    {
      from: 'INTAKE',
      to: 'DONE',
      trigger: 'completion',
      traversed: true,
      traversalCount: 1,
    },
  ],
};

describe('WorkflowGraph visibility recovery', () => {
  it('re-fits the graph when the visible prop transitions from false to true', async () => {
    const { rerender } = render(<WorkflowGraph workflow={workflow} visible={false} />);
    fitViewMock.mockClear();

    rerender(<WorkflowGraph workflow={workflow} visible={true} />);

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
    });
  });

  it('re-fits the graph when workflow data refreshes', async () => {
    const { rerender } = render(<WorkflowGraph workflow={workflow} />);
    fitViewMock.mockClear();

    rerender(<WorkflowGraph workflow={refreshedWorkflow} />);

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
    });
  });
});
