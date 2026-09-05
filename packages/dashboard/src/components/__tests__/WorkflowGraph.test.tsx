// @vitest-environment jsdom
import type { WorkflowStateView } from '@ai-dev-orchestrator/schemas';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkflowGraph } from '../WorkflowGraph';

const baseWorkflow: WorkflowStateView = {
  runId: 'run-1',
  currentState: 'IMPLEMENTATION',
  visitedStates: ['PLANNING', 'IMPLEMENTATION'],
  stateHistory: ['PLANNING', 'IMPLEMENTATION'],
  states: [
    {
      id: 'PLANNING',
      type: 'action',
      label: 'Planning',
      visited: true,
      current: false,
      timeSpentMs: 2300,
      visitCount: 1,
    },
    {
      id: 'IMPLEMENTATION',
      type: 'action',
      label: 'Implementation',
      visited: true,
      current: true,
      timeSpentMs: 5000,
      visitCount: 1,
    },
    {
      id: 'CODE_REVIEW',
      type: 'review',
      label: 'Code Review',
      visited: false,
      current: false,
      timeSpentMs: 0,
      visitCount: 0,
    },
  ],
  transitions: [
    {
      from: 'PLANNING',
      to: 'IMPLEMENTATION',
      trigger: 'plan_approved',
      traversed: true,
      traversalCount: 1,
    },
    {
      from: 'IMPLEMENTATION',
      to: 'CODE_REVIEW',
      trigger: 'impl_done',
      traversed: false,
      traversalCount: 0,
    },
    {
      from: 'CODE_REVIEW',
      to: 'IMPLEMENTATION',
      trigger: 'revisions_needed',
      traversed: false,
      traversalCount: 0,
    },
  ],
};

describe('WorkflowGraph', () => {
  it('renders without crashing', () => {
    const { container } = render(<WorkflowGraph workflow={baseWorkflow} />);
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('applies pulse class to the current state node', () => {
    const { container } = render(<WorkflowGraph workflow={baseWorkflow} />);
    const pulseNodes = container.querySelectorAll('.state-pulse');
    expect(pulseNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows time spent for visited states', () => {
    const { container } = render(<WorkflowGraph workflow={baseWorkflow} />);
    expect(container.textContent).toContain('2s');
    expect(container.textContent).toContain('5s');
  });

  it('does not show visit count badge', () => {
    const loopWorkflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'IMPLEMENTATION' ? { ...s, visitCount: 3 } : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={loopWorkflow} />);
    expect(container.textContent).not.toContain('×3');
  });

  it('renders robot icon for agent-dispatched states with roles', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'IMPLEMENTATION' ? { ...s, roles: ['implementer'] } : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={workflow} />);
    const roleIcons = container.querySelectorAll('[role="img"][aria-label*="Roles:"]');
    expect(roleIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders script icon for script-dispatched states', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'IMPLEMENTATION'
          ? { ...s, type: 'script', scripts: ['upload-findings-gist.ts'], roles: undefined }
          : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={workflow} />);
    const scriptIcons = container.querySelectorAll('[role="img"][aria-label*="Scripts:"]');
    expect(scriptIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows script tooltip on hover', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'PLANNING'
          ? { ...s, type: 'script', scripts: ['upload-findings-gist.ts'], roles: undefined }
          : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={workflow} />);
    const icon = container.querySelector('[role="img"][aria-label*="Scripts:"]');
    expect(icon).toBeInTheDocument();

    fireEvent.mouseEnter(icon as Element);
    expect(container.textContent).toContain('upload-findings-gist.ts');

    fireEvent.mouseLeave(icon as Element);
    expect(container.textContent).not.toContain('upload-findings-gist.ts');
  });

  it('does not render role icon for states without roles', () => {
    const { container } = render(<WorkflowGraph workflow={baseWorkflow} />);
    const roleIcons = container.querySelectorAll('[role="img"][aria-label*="Roles:"]');
    expect(roleIcons.length).toBe(0);
  });

  it('shows role tooltip on hover', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'PLANNING' ? { ...s, roles: ['planner'] } : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={workflow} />);
    const icon = container.querySelector('[role="img"][aria-label*="Roles:"]');
    expect(icon).toBeInTheDocument();

    expect(container.textContent).not.toContain('Planner');

    fireEvent.mouseEnter(icon as Element);
    expect(container.textContent).toContain('Planner');

    fireEvent.mouseLeave(icon as Element);
    expect(container.textContent).not.toContain('Planner');
  });

  it('shows multiple roles in tooltip', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'CODE_REVIEW'
          ? {
              ...s,
              visited: true,
              roles: ['static_reviewer', 'design_reviewer'],
              parallelInfo: {
                type: 'fork' as const,
                parallelRoles: ['static_reviewer', 'design_reviewer'],
              },
            }
          : s,
      ),
    };
    const { container } = render(<WorkflowGraph workflow={workflow} />);
    const icons = container.querySelectorAll('[role="img"][aria-label*="Roles:"]');
    expect(icons.length).toBeGreaterThanOrEqual(1);

    fireEvent.mouseEnter(icons[0]);
    expect(container.textContent).toContain('Static Reviewer');
  });

  it('shows agent runner tooltip with runner and model on hover', () => {
    const workflow: WorkflowStateView = {
      ...baseWorkflow,
      states: baseWorkflow.states.map((s) =>
        s.id === 'IMPLEMENTATION' ? { ...s, roles: ['implementer'] } : s,
      ),
    };
    const assignments = [
      { role: 'implementer', dispatchType: 'agent', runner: 'claude-code', model: 'claude-opus' },
    ];
    const { container } = render(
      <WorkflowGraph workflow={workflow} roleAssignments={assignments} />,
    );
    const icon = container.querySelector('[role="img"][aria-label*="Runner:"]');
    expect(icon).toBeInTheDocument();

    fireEvent.mouseEnter(icon as Element);
    expect(container.textContent).toContain('Claude Code · claude-opus');
  });
});
