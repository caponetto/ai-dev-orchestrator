// @vitest-environment jsdom
import type { WorkflowStateView } from '@ai-orchestrator/schemas';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { WorkflowsPage } from '../WorkflowsPage';

const workflows = [
  { name: 'default', version: '1.0.0', stateCount: 3 },
  { name: 'review', version: '2.0.0', stateCount: 5 },
];

function previewFor(name: string): WorkflowStateView {
  return {
    runId: '',
    currentState: 'planning',
    visitedStates: ['planning'],
    stateHistory: ['planning'],
    states: [
      {
        id: 'planning',
        label: name,
        type: 'action',
        visited: true,
        current: true,
        timeSpentMs: 0,
        visitCount: 1,
      },
      {
        id: 'DONE',
        label: 'done',
        type: 'terminal',
        visited: false,
        current: false,
        timeSpentMs: 0,
        visitCount: 0,
      },
    ],
    transitions: [
      {
        from: 'planning',
        to: 'DONE',
        trigger: 'complete',
        traversed: false,
        traversalCount: 0,
      },
    ],
  };
}

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = MockEventSource.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(_url: string) {
    setTimeout(() => this.onopen?.(new Event('open')), 0);
  }
  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

const server = setupServer(
  http.get('/api/workflows', () => HttpResponse.json(workflows)),
  http.get('/api/workflows/:name/preview', ({ params }) =>
    HttpResponse.json(previewFor(params['name'] as string)),
  ),
);

beforeAll(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});

describe('WorkflowsPage', () => {
  it('shows workflow list after loading', async () => {
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      expect(screen.getByText('default')).toBeTruthy();
    });
    expect(screen.getByText('review')).toBeTruthy();
  });

  it('shows version and state count for each workflow', async () => {
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      expect(screen.getByText('default')).toBeTruthy();
    });
    expect(screen.getByText('v1.0.0')).toBeTruthy();
    expect(screen.getByText('3 states')).toBeTruthy();
  });

  it('auto-selects first workflow', async () => {
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      const defaultItem = screen.getByText('default').closest('[role="option"]');
      expect(defaultItem?.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('clicking a different workflow selects it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy();
    });

    await user.click(screen.getByText('review'));

    await waitFor(() => {
      const reviewItem = screen.getByText('review').closest('[role="option"]');
      expect(reviewItem?.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('shows error state when fetchWorkflows fails', async () => {
    server.use(http.get('/api/workflows', () => HttpResponse.json({}, { status: 500 })));
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load workflows/i)).toBeTruthy();
    });
  });

  it('shows empty state when no workflows exist', async () => {
    server.use(http.get('/api/workflows', () => HttpResponse.json([])));
    renderWithRouter(<WorkflowsPage />);
    await waitFor(() => {
      expect(screen.getByText('No workflows found')).toBeTruthy();
    });
  });

  it('pre-selects workflow from URL query param', async () => {
    renderWithRouter(<WorkflowsPage />, { route: '/workflows?selected=review' });
    await waitFor(() => {
      const reviewItem = screen.getByText('review').closest('[role="option"]');
      expect(reviewItem?.getAttribute('aria-selected')).toBe('true');
    });
  });
});
