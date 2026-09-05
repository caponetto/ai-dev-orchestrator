// @vitest-environment jsdom
import type { RunStateView } from '@ai-dev-orchestrator/schemas';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import type { RerunContext } from '../RunHeader';
import { RunHeader } from '../RunHeader';

vi.mock('../../api/client', () => ({
  api: {
    abort: vi.fn().mockResolvedValue({ success: true }),
    retry: vi.fn().mockResolvedValue({ success: true }),
    createRun: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const mockRerunContext: RerunContext = {
  prompt: 'Build a REST API',
  workflow: 'dev',
  repoRoot: '/home/user/my-project',
};

const mockState: RunStateView = {
  runId: 'run-abc123',
  status: 'running',
  currentState: 'implementation',
  previousState: 'planning',
  startedAt: new Date().toISOString(),
  stateEnteredAt: new Date().toISOString(),
  elapsedMs: 45000,
  transitionCount: 3,
  isWaitingForHuman: false,
  repoRoot: '/home/user/my-project',
};

describe('RunHeader', () => {
  it('renders the run ID', () => {
    renderWithRouter(<RunHeader state={mockState} />);
    expect(screen.getByText('run-abc123')).toBeInTheDocument();
  });

  it('renders the status badge', () => {
    renderWithRouter(<RunHeader state={mockState} />);
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('displays the repo context', () => {
    renderWithRouter(<RunHeader state={mockState} />);
    expect(screen.getByText('my-project')).toBeInTheDocument();
  });

  it('shows abort button for active runs', () => {
    renderWithRouter(<RunHeader state={mockState} onAbort={vi.fn()} />);
    expect(screen.getByRole('button', { name: /abort/i })).toBeInTheDocument();
  });

  it('hides abort button for completed runs', () => {
    const completed: RunStateView = { ...mockState, status: 'completed' };
    renderWithRouter(<RunHeader state={completed} onAbort={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /abort/i })).not.toBeInTheDocument();
  });

  it('shows waiting banner when waiting for human', () => {
    const waiting: RunStateView = {
      ...mockState,
      isWaitingForHuman: true,
    };
    renderWithRouter(<RunHeader state={waiting} />);
    expect(screen.getByText('Awaiting human approval')).toBeInTheDocument();
  });

  it('renders token usage when provided', () => {
    renderWithRouter(
      <RunHeader
        state={mockState}
        tokenUsage={{ totalInputTokens: 50000, totalOutputTokens: 25000 }}
      />,
    );
    expect(screen.getByText('Tokens')).toBeInTheDocument();
  });

  it('shows rerun button for completed runs', () => {
    const completed: RunStateView = { ...mockState, status: 'completed' };
    renderWithRouter(
      <RunHeader state={completed} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /rerun/i })).toBeInTheDocument();
  });

  it('shows rerun button for aborted runs', () => {
    const aborted: RunStateView = { ...mockState, status: 'aborted' };
    renderWithRouter(
      <RunHeader state={aborted} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /rerun/i })).toBeInTheDocument();
  });

  it('shows rerun button for failed runs', () => {
    const failed: RunStateView = { ...mockState, status: 'failed' };
    renderWithRouter(
      <RunHeader state={failed} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /rerun/i })).toBeInTheDocument();
  });

  it('hides rerun button for running state', () => {
    renderWithRouter(
      <RunHeader state={mockState} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /rerun/i })).not.toBeInTheDocument();
  });

  it('hides rerun button when rerunContext is not provided', () => {
    const completed: RunStateView = { ...mockState, status: 'completed' };
    renderWithRouter(<RunHeader state={completed} onRerun={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /rerun/i })).not.toBeInTheDocument();
  });

  it('shows retry button for aborted runs but not for running or completed', () => {
    const aborted: RunStateView = { ...mockState, status: 'aborted' };
    const { unmount } = renderWithRouter(<RunHeader state={aborted} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    unmount();

    const failed: RunStateView = { ...mockState, status: 'failed' };
    const { unmount: unmount2 } = renderWithRouter(<RunHeader state={failed} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    unmount2();

    renderWithRouter(<RunHeader state={mockState} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('opens AbortDialog when Abort button is clicked', () => {
    renderWithRouter(<RunHeader state={mockState} onAbort={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /abort/i }));
    expect(screen.getByRole('heading', { name: 'Abort Run' })).toBeInTheDocument();
  });

  it('opens RetryDialog when Retry button is clicked', () => {
    const failed: RunStateView = { ...mockState, status: 'failed' };
    renderWithRouter(<RunHeader state={failed} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByRole('heading', { name: 'Retry Run' })).toBeInTheDocument();
  });

  it('opens RerunDialog when Rerun button is clicked', () => {
    const completed: RunStateView = { ...mockState, status: 'completed' };
    renderWithRouter(
      <RunHeader state={completed} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /rerun/i }));
    expect(screen.getByText('Rerun Workflow')).toBeInTheDocument();
  });

  it('shows budget exceeded banner when isWaitingForHuman with budgetExhaustion', () => {
    const waiting: RunStateView = {
      ...mockState,
      isWaitingForHuman: true,
      waitingContext: {
        reason: 'Budget exceeded',
        requiredInput: 'approval',
        requestingState: 'implementation',
        autoResumeSafe: false,
        presentedArtifacts: [],
        waitingSince: new Date().toISOString(),
        budgetExhaustion: {
          limitType: 'token' as const,
          current: 100000,
          limit: 80000,
          cumulativeTokens: 100000,
        },
      },
    };
    renderWithRouter(<RunHeader state={waiting} />);
    expect(screen.getByText(/budget exceeded/i)).toBeInTheDocument();
  });

  it('does not show token display when tokenUsage has all zeros', () => {
    renderWithRouter(
      <RunHeader state={mockState} tokenUsage={{ totalInputTokens: 0, totalOutputTokens: 0 }} />,
    );
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
  });

  it('does not show token display when tokenUsage is undefined', () => {
    renderWithRouter(<RunHeader state={mockState} />);
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
  });

  it('shows rerun button for interrupted runs with rerunContext', () => {
    const interrupted: RunStateView = { ...mockState, status: 'interrupted' };
    renderWithRouter(
      <RunHeader state={interrupted} rerunContext={mockRerunContext} onRerun={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /rerun/i })).toBeInTheDocument();
  });

  it('does not show repo context section when repoRoot is undefined', () => {
    const noRepo: RunStateView = { ...mockState, repoRoot: undefined };
    renderWithRouter(<RunHeader state={noRepo} />);
    expect(screen.queryByText('Context')).not.toBeInTheDocument();
  });

  it('shows process not responding banner when processAlive is false and running', () => {
    const deadProcess: RunStateView = { ...mockState, status: 'running', processAlive: false };
    renderWithRouter(<RunHeader state={deadProcess} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/process not responding/i)).toBeInTheDocument();
  });

  it('does not show process banner when processAlive is true', () => {
    const aliveProcess: RunStateView = { ...mockState, status: 'running', processAlive: true };
    renderWithRouter(<RunHeader state={aliveProcess} />);
    expect(screen.queryByText(/process not responding/i)).not.toBeInTheDocument();
  });

  it('does not show process banner for terminal states even when processAlive is false', () => {
    const completed: RunStateView = { ...mockState, status: 'completed', processAlive: false };
    renderWithRouter(<RunHeader state={completed} />);
    expect(screen.queryByText(/process not responding/i)).not.toBeInTheDocument();
  });
});
