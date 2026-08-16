// @vitest-environment jsdom
import type { DashboardWaitingContext } from '@ai-orchestrator/schemas';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { server } from '../../test/server';
import { ActionBar } from '../ActionBar';

const baseContext: DashboardWaitingContext = {
  reason: 'Plan review requires approval',
  requiredInput: 'approval',
  requestingState: 'PLAN_REVIEW',
  autoResumeSafe: false,
  presentedArtifacts: [],
  waitingSince: '2026-01-01T00:00:00Z',
};

describe('ActionBar', () => {
  it('renders for persisted waiting state', () => {
    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);
    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(screen.getByText('Action Required')).toBeInTheDocument();
    expect(screen.getByText('Plan Review')).toBeInTheDocument();
  });

  it('shows approve and reject buttons for approval input', () => {
    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Reason for rejection...')).not.toBeInTheDocument();
  });

  it('shows reject form with textarea when reject is clicked', async () => {
    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Reject'));

    expect(screen.getByPlaceholderText('Reason for rejection...')).toBeInTheDocument();
    expect(screen.getByText('Confirm Rejection')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('hides reject form when cancel is clicked', async () => {
    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Reject'));
    expect(screen.getByPlaceholderText('Reason for rejection...')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Reason for rejection...')).not.toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('shows answer form for text input', () => {
    const textContext: DashboardWaitingContext = {
      ...baseContext,
      requiredInput: 'text',
      reason: 'Clarification needed',
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={textContext} onAction={() => {}} />);
    expect(screen.getByText('Submit Answer')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('shows presented artifacts when available', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      presentedArtifacts: [{ type: 'plan', name: 'main-plan', version: 1, checksum: 'abc' }],
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(screen.getByText('Plan v1')).toBeInTheDocument();
  });

  it('calls approve API when approve button is clicked', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/runs/run-1/approve', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    let actionCalled = false;
    renderWithRouter(
      <ActionBar
        runId="run-1"
        waitingContext={baseContext}
        onAction={() => {
          actionCalled = true;
        }}
      />,
    );

    await user.click(screen.getByText('Approve'));

    expect(capturedBody).toBeTruthy();
    expect(actionCalled).toBe(true);
  });

  it('shows approved outcome after successful approve', async () => {
    server.use(
      http.post('/api/runs/run-1/approve', () => {
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(screen.getByText(/Approved plan review/i)).toBeInTheDocument();
    });
  });

  it('shows error message when approve API returns failure', async () => {
    server.use(
      http.post('/api/runs/run-1/approve', () => {
        return HttpResponse.json({ success: false, error: 'Not allowed' });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(screen.getByText('Not allowed')).toBeInTheDocument();
    });
  });

  it('shows error message when approve API throws an exception', async () => {
    server.use(
      http.post('/api/runs/run-1/approve', () => {
        return HttpResponse.error();
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      const errorEl = screen.getByText((_content, element) => {
        return (
          element?.tagName === 'P' &&
          element.classList.contains('text-destructive') &&
          element.textContent.length > 0
        );
      });
      expect(errorEl).toBeInTheDocument();
    });
  });

  it('shows rejected outcome after successful reject with reason', async () => {
    server.use(
      http.post('/api/runs/run-1/reject', () => {
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Reject'));
    await user.type(screen.getByPlaceholderText('Reason for rejection...'), 'Needs revision');
    await user.click(screen.getByText('Confirm Rejection'));

    await waitFor(() => {
      expect(screen.getByText(/Rejected plan review/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Needs revision/)).toBeInTheDocument();
  });

  it('shows error message when reject API returns failure', async () => {
    server.use(
      http.post('/api/runs/run-1/reject', () => {
        return HttpResponse.json({ success: false, error: 'Reject failed' });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Reject'));
    await user.type(screen.getByPlaceholderText('Reason for rejection...'), 'Bad plan');
    await user.click(screen.getByText('Confirm Rejection'));

    await waitFor(() => {
      expect(screen.getByText('Reject failed')).toBeInTheDocument();
    });
  });

  it('disables Confirm Rejection when textarea is empty', async () => {
    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Reject'));

    const confirmButton = screen.getByText('Confirm Rejection');
    expect(confirmButton).toBeDisabled();
  });

  it('calls onSubmitting callback when approve is clicked', async () => {
    server.use(
      http.post('/api/runs/run-1/approve', () => {
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    const onSubmitting = vi.fn();
    renderWithRouter(
      <ActionBar
        runId="run-1"
        waitingContext={baseContext}
        onAction={() => {}}
        onSubmitting={onSubmitting}
      />,
    );

    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(onSubmitting).toHaveBeenCalledOnce();
    });
  });

  it('calls onViewArtifact when artifact button is clicked', async () => {
    const artifact = { type: 'plan' as const, name: 'main-plan', version: 1, checksum: 'abc' };
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      presentedArtifacts: [artifact],
    };

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    const onViewArtifact = vi.fn();
    renderWithRouter(
      <ActionBar
        runId="run-1"
        waitingContext={ctx}
        onAction={() => {}}
        onViewArtifact={onViewArtifact}
      />,
    );

    await user.click(screen.getByText('Plan v1'));

    expect(onViewArtifact).toHaveBeenCalledOnce();
    expect(onViewArtifact).toHaveBeenCalledWith(artifact);
  });

  it('shows governance escalation reason', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      reason: 'governance_escalation',
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(screen.getByText(/Review iteration limit reached at Plan Review/)).toBeInTheDocument();
  });

  it('shows token budget exceeded reason with values', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      reason: 'token_budget_exceeded',
      budgetExhaustion: {
        limitType: 'token',
        current: 6500000,
        limit: 6000000,
        cumulativeTokens: 6500000,
      },
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(screen.getByText(/Token budget exceeded.*6500000.*6000000/)).toBeInTheDocument();
  });

  it('shows token budget exceeded reason without values', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      reason: 'token_budget_exceeded',
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(screen.getByText('Token budget exceeded. Approve to continue.')).toBeInTheDocument();
  });

  it('shows clarification reason', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      reason: 'clarification_needed',
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(
      screen.getByText(/Plan Review needs clarification before continuing/),
    ).toBeInTheDocument();
  });

  it('shows default reason for unknown reason types', () => {
    const ctx: DashboardWaitingContext = {
      ...baseContext,
      reason: 'some_future_reason',
    };
    renderWithRouter(<ActionBar runId="run-1" waitingContext={ctx} onAction={() => {}} />);
    expect(screen.getByText(/Plan Review is waiting for your decision/)).toBeInTheDocument();
  });

  it('shows error when approve API throws a non-Error value', async () => {
    server.use(
      http.post('/api/runs/run-1/approve', () => {
        return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    const { user } = await import('@testing-library/user-event').then((m) => ({
      user: m.default.setup(),
    }));

    renderWithRouter(<ActionBar runId="run-1" waitingContext={baseContext} onAction={() => {}} />);

    await user.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(screen.getByText(/500 Internal Server Error/)).toBeInTheDocument();
    });
  });
});
