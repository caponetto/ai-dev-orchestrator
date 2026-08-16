// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventStreamProvider } from '../../hooks/event-stream-context';
import { RunListPage } from '../RunListPage';

let runRequests = 0;

const server = setupServer(
  http.get('/api/runs', () => {
    runRequests += 1;
    if (runRequests === 1) {
      return HttpResponse.json([
        {
          runId: 'run-001',
          repository: 'repo',
          workflow: 'default',
          status: 'running',
          startedAt: '2026-01-01T10:00:00Z',
          completedAt: '',
          durationMs: 3_000,
          totalArtifacts: 0,
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          finalState: 'INTAKE',
        },
      ]);
    }

    return HttpResponse.json([
      {
        runId: 'run-001',
        repository: 'repo',
        workflow: 'default',
        status: 'running',
        startedAt: '2026-01-01T10:00:00Z',
        completedAt: '',
        durationMs: 6_000,
        totalArtifacts: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        finalState: 'PLANNING',
      },
      {
        runId: 'run-002',
        repository: 'repo',
        workflow: 'default',
        status: 'running',
        startedAt: '2026-01-01T10:00:05Z',
        completedAt: '',
        durationMs: 1_000,
        totalArtifacts: 1,
        totalTokens: 120,
        totalInputTokens: 80,
        totalOutputTokens: 40,
        finalState: 'INTAKE',
      },
    ]);
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  server.resetHandlers();
  runRequests = 0;
});

afterAll(() => {
  server.close();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <EventStreamProvider>
        <RunListPage />
      </EventStreamProvider>
    </MemoryRouter>,
  );
}

describe('RunListPage', () => {
  it('refreshes the run list automatically while the dashboard is open', async () => {
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-001')).toBeTruthy();
    });
    expect(screen.queryByText('run-002')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5_500);
    });

    await waitFor(() => {
      expect(tableView().getByText('run-002')).toBeTruthy();
    });
    expect(runRequests).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scopes queries to the desktop table (mobile cards duplicate run IDs in the DOM). */
function tableView() {
  return within(screen.getByTestId('runs-table'));
}

/** Captures the current router location so navigation assertions can inspect the pathname. */
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderPageWithLocation() {
  return render(
    <MemoryRouter>
      <EventStreamProvider>
        <RunListPage />
        <LocationDisplay />
      </EventStreamProvider>
    </MemoryRouter>,
  );
}

interface RunData {
  runId: string;
  repository: string;
  repoRoot?: string;
  workflow: string;
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalArtifacts: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  finalState: string;
}

function makeRun(overrides: Partial<RunData> & { runId: string }): RunData {
  return {
    repository: 'repo',
    repoRoot: '/home/user/project',
    workflow: 'default',
    status: 'running',
    startedAt: '2026-01-01T10:00:00Z',
    completedAt: '',
    durationMs: 5_000,
    totalArtifacts: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    finalState: 'PLANNING',
    ...overrides,
  };
}

function overrideRunsHandler(runs: RunData[]) {
  server.use(
    http.get('/api/runs', () => {
      return HttpResponse.json(runs);
    }),
  );
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('RunListPage - loading state', () => {
  it('shows skeleton placeholders while the fetch is in-flight', () => {
    server.use(
      http.get('/api/runs', () => {
        // Never resolve during the assertion window - the component stays in loading state.
        return new Promise(() => {
          /* intentionally pending */
        });
      }),
    );

    renderPage();

    // The Skeleton component renders <div data-slot="skeleton" ...>
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);

    // The data table should NOT be present
    expect(screen.queryByText('Run ID')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('RunListPage - error state', () => {
  it('shows an error message when the API returns a server error', async () => {
    server.use(
      http.get('/api/runs', () => {
        return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Failed to load runs/)).toBeTruthy();
    });
    expect(screen.getByText(/Make sure the backend is running/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('RunListPage - empty state', () => {
  it('renders the empty state when there are no runs', async () => {
    overrideRunsHandler([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No runs yet')).toBeTruthy();
    });
    expect(screen.getByText('Start a new run to begin orchestrating your AI agents')).toBeTruthy();
    expect(screen.getByText('Create your first run')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Search filter
// ---------------------------------------------------------------------------

describe('RunListPage - search filter', () => {
  const runs = [
    makeRun({ runId: 'run-alpha', workflow: 'default', repoRoot: '/home/user/project-a' }),
    makeRun({ runId: 'run-beta', workflow: 'review', repoRoot: '/home/user/project-b' }),
    makeRun({ runId: 'run-gamma', workflow: 'default', repoRoot: '/home/user/project-a' }),
  ];

  it('filters runs by runId when the user types in the search box', async () => {
    overrideRunsHandler(runs);
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-alpha')).toBeTruthy();
    });
    expect(tableView().getByText('run-beta')).toBeTruthy();
    expect(tableView().getByText('run-gamma')).toBeTruthy();

    const searchInput = screen.getByPlaceholderText('Search runs... (/ to focus)');
    fireEvent.change(searchInput, { target: { value: 'beta' } });
    await act(() => vi.advanceTimersByTimeAsync(350));

    await waitFor(() => {
      expect(tableView().getByText('run-beta')).toBeTruthy();
    });
    expect(screen.queryByText('run-alpha')).toBeNull();
    expect(screen.queryByText('run-gamma')).toBeNull();
  });

  it('filters runs by workflow name', async () => {
    overrideRunsHandler(runs);
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-alpha')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search runs... (/ to focus)');
    fireEvent.change(searchInput, { target: { value: 'review' } });
    await act(() => vi.advanceTimersByTimeAsync(350));

    await waitFor(() => {
      expect(tableView().getByText('run-beta')).toBeTruthy();
    });
    expect(screen.queryByText('run-alpha')).toBeNull();
    expect(screen.queryByText('run-gamma')).toBeNull();
  });

  it('shows "No runs match your filters" when search matches nothing', async () => {
    overrideRunsHandler(runs);
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-alpha')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search runs... (/ to focus)');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    await act(() => vi.advanceTimersByTimeAsync(350));

    await waitFor(() => {
      expect(screen.getByText('No runs match your filters')).toBeTruthy();
    });
  });

  it('clears the search when clicking the clear button', async () => {
    overrideRunsHandler(runs);
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-alpha')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search runs... (/ to focus)');
    fireEvent.change(searchInput, { target: { value: 'beta' } });
    await act(() => vi.advanceTimersByTimeAsync(350));

    await waitFor(() => {
      expect(screen.queryByText('run-alpha')).toBeNull();
    });

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);
    await act(() => vi.advanceTimersByTimeAsync(350));

    await waitFor(() => {
      expect(tableView().getByText('run-alpha')).toBeTruthy();
      expect(tableView().getByText('run-beta')).toBeTruthy();
      expect(tableView().getByText('run-gamma')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe('RunListPage - status filter', () => {
  const runs = [
    makeRun({ runId: 'run-running', status: 'running' }),
    makeRun({ runId: 'run-completed', status: 'completed' }),
    makeRun({ runId: 'run-failed', status: 'failed' }),
  ];

  it('filters runs to only completed when status=completed is in the URL', async () => {
    overrideRunsHandler(runs);

    // The component reads status from useSearchParams, so setting the URL param drives filtering.
    render(
      <MemoryRouter initialEntries={['/?status=completed']}>
        <EventStreamProvider>
          <RunListPage />
        </EventStreamProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(tableView().getByText('run-completed')).toBeTruthy();
    });
    expect(screen.queryByText('run-running')).toBeNull();
    expect(screen.queryByText('run-failed')).toBeNull();
  });

  it('filters runs to only failed when status=failed is in the URL', async () => {
    overrideRunsHandler(runs);

    render(
      <MemoryRouter initialEntries={['/?status=failed']}>
        <EventStreamProvider>
          <RunListPage />
        </EventStreamProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(tableView().getByText('run-failed')).toBeTruthy();
    });
    expect(screen.queryByText('run-running')).toBeNull();
    expect(screen.queryByText('run-completed')).toBeNull();
  });

  it('shows all runs when status is set to all', async () => {
    overrideRunsHandler(runs);

    render(
      <MemoryRouter initialEntries={['/?status=all']}>
        <EventStreamProvider>
          <RunListPage />
        </EventStreamProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(tableView().getByText('run-running')).toBeTruthy();
      expect(tableView().getByText('run-completed')).toBeTruthy();
      expect(tableView().getByText('run-failed')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('RunListPage - pagination', () => {
  // Generate 20 runs to exceed PAGE_SIZE of 15
  const manyRuns = Array.from({ length: 20 }, (_, i) =>
    makeRun({
      runId: `run-${String(i + 1).padStart(3, '0')}`,
      startedAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
      durationMs: (i + 1) * 1_000,
    }),
  );

  it('shows pagination controls when there are more than 15 runs', async () => {
    overrideRunsHandler(manyRuns);
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Next page')).toBeTruthy();
    });

    // Page 1 button should be the current page
    expect(screen.getByLabelText('Page 1')).toBeTruthy();
    expect(screen.getByLabelText('Page 2')).toBeTruthy();

    // Previous page should be disabled on first page
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
  });

  it('navigates to the second page when clicking next', async () => {
    overrideRunsHandler(manyRuns);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Next page')).toBeTruthy();
    });

    // Click next page
    await user.click(screen.getByLabelText('Next page'));

    // The pagination text should update
    await waitFor(() => {
      expect(screen.getByText(/16/)).toBeTruthy();
    });

    // Next page should now be disabled (only 20 runs = 2 pages)
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    // Previous page should be enabled
    expect(screen.getByLabelText('Previous page')).toBeEnabled();
  });

  it('navigates to a specific page when clicking the page number', async () => {
    overrideRunsHandler(manyRuns);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Page 2')).toBeTruthy();
    });

    await user.click(screen.getByLabelText('Page 2'));

    await waitFor(() => {
      expect(screen.getByText(/16/)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Sort columns
// ---------------------------------------------------------------------------

describe('RunListPage - sorting', () => {
  const runs = [
    makeRun({
      runId: 'run-aaa',
      startedAt: '2026-01-03T10:00:00Z',
      durationMs: 1_000,
      totalArtifacts: 5,
    }),
    makeRun({
      runId: 'run-bbb',
      startedAt: '2026-01-01T10:00:00Z',
      durationMs: 3_000,
      totalArtifacts: 1,
    }),
    makeRun({
      runId: 'run-ccc',
      startedAt: '2026-01-02T10:00:00Z',
      durationMs: 2_000,
      totalArtifacts: 10,
    }),
  ];

  function getRunIdOrder(): string[] {
    const cells = tableView().getAllByText(/^run-/);
    return cells.map((cell) => cell.textContent ?? ''); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- textContent can be null per DOM spec
  }

  it('sorts by Run ID ascending when clicking the Run ID header', async () => {
    overrideRunsHandler(runs);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-aaa')).toBeTruthy();
    });

    // Click "Run ID" header - first click sets desc since it's a new sort key
    await user.click(screen.getByText('Run ID'));

    await waitFor(() => {
      const order = getRunIdOrder();
      expect(order).toEqual(['run-ccc', 'run-bbb', 'run-aaa']);
    });

    // Click again to toggle to asc
    await user.click(screen.getByText('Run ID'));

    await waitFor(() => {
      const order = getRunIdOrder();
      expect(order).toEqual(['run-aaa', 'run-bbb', 'run-ccc']);
    });
  });

  it('sorts by Started descending by default', async () => {
    overrideRunsHandler(runs);
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-aaa')).toBeTruthy();
    });

    // Default sort is startedAt desc, so run-aaa (Jan 3) should be first
    const order = getRunIdOrder();
    expect(order).toEqual(['run-aaa', 'run-ccc', 'run-bbb']);
  });

  it('toggles sort direction when clicking the same header twice', async () => {
    overrideRunsHandler(runs);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-aaa')).toBeTruthy();
    });

    // Default is startedAt desc. Click "Started" to toggle to asc.
    await user.click(screen.getByText('Started'));

    await waitFor(() => {
      const order = getRunIdOrder();
      // asc by startedAt: bbb (Jan 1), ccc (Jan 2), aaa (Jan 3)
      expect(order).toEqual(['run-bbb', 'run-ccc', 'run-aaa']);
    });
  });
});

// ---------------------------------------------------------------------------
// Delete flow
// ---------------------------------------------------------------------------

describe('RunListPage - delete flow', () => {
  const runs = [
    makeRun({ runId: 'run-to-delete', status: 'completed' }),
    makeRun({ runId: 'run-to-keep', status: 'running' }),
  ];

  it('selects a run, opens delete dialog, and confirms deletion', async () => {
    const deletedIds: string[] = [];

    server.use(
      http.get('/api/runs', () => {
        return HttpResponse.json(runs);
      }),
      http.delete('/api/runs/:runId', ({ params }) => {
        deletedIds.push(params['runId'] as string);
        return HttpResponse.json({ success: true });
      }),
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-to-delete')).toBeTruthy();
    });

    // Click the checkbox for the first run
    const checkbox = screen.getByLabelText('Select run run-to-delete');
    await user.click(checkbox);

    // The delete button should appear
    const deleteButton = await screen.findByText(/Delete \(1\)/);
    expect(deleteButton).toBeTruthy();

    // Click the delete button to open the dialog
    await user.click(deleteButton);

    // The confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Delete Runs')).toBeTruthy();
    });
    expect(
      screen.getByText(/Are you sure you want to delete 1 run\? This cannot be undone\./),
    ).toBeTruthy();

    // Click the confirm delete button in the dialog
    const dialogContent = screen.getByText('Delete Runs').closest('[data-slot="dialog-content"]');
    expect(dialogContent).toBeTruthy();
    const confirmButton = within(dialogContent as HTMLElement).getByRole('button', {
      name: 'Delete',
    });
    await user.click(confirmButton);

    // The delete API should have been called
    await waitFor(() => {
      expect(deletedIds).toContain('run-to-delete');
    });
  });

  it('cancels deletion when clicking Cancel in the dialog', async () => {
    let deleteCalled = false;

    server.use(
      http.get('/api/runs', () => {
        return HttpResponse.json(runs);
      }),
      http.delete('/api/runs/:runId', () => {
        deleteCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-to-delete')).toBeTruthy();
    });

    // Select a run and open the delete dialog
    await user.click(screen.getByLabelText('Select run run-to-delete'));
    await user.click(await screen.findByText(/Delete \(1\)/));

    await waitFor(() => {
      expect(screen.getByText('Delete Runs')).toBeTruthy();
    });

    // Click Cancel
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    // The dialog should close, and no delete should have been made
    await waitFor(() => {
      expect(screen.queryByText('Delete Runs')).toBeNull();
    });
    expect(deleteCalled).toBe(false);
  });

  it('opens context menu on right-click and deletes the run', async () => {
    const deletedIds: string[] = [];

    server.use(
      http.get('/api/runs', () => {
        return HttpResponse.json(runs);
      }),
      http.delete('/api/runs/:runId', ({ params }) => {
        deletedIds.push(params['runId'] as string);
        return HttpResponse.json({ success: true });
      }),
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-to-delete')).toBeTruthy();
    });

    const row = tableView().getByText('run-to-delete').closest('tr') as HTMLElement;
    fireEvent.contextMenu(row);

    const deleteItem = await screen.findByText('Delete');
    await user.click(deleteItem);

    await waitFor(() => {
      expect(screen.getByText('Delete Runs')).toBeTruthy();
    });

    const dialogContent = screen.getByText('Delete Runs').closest('[data-slot="dialog-content"]');
    const confirmButton = within(dialogContent as HTMLElement).getByRole('button', {
      name: 'Delete',
    });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(deletedIds).toContain('run-to-delete');
    });
  });

  it('shows delete count for multiple selected runs', async () => {
    server.use(
      http.get('/api/runs', () => {
        return HttpResponse.json(runs);
      }),
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(tableView().getByText('run-to-delete')).toBeTruthy();
    });

    // Select both runs
    await user.click(screen.getByLabelText('Select run run-to-delete'));
    await user.click(screen.getByLabelText('Select run run-to-keep'));

    // The delete button should show count of 2
    expect(await screen.findByText(/Delete \(2\)/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Run row click (navigation)
// ---------------------------------------------------------------------------

describe('RunListPage - row navigation', () => {
  it('navigates to the run detail page when clicking a run row', async () => {
    const runs = [makeRun({ runId: 'run-nav-target' })];

    overrideRunsHandler(runs);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPageWithLocation();

    await waitFor(() => {
      expect(tableView().getByText('run-nav-target')).toBeTruthy();
    });

    // Click the run row (not the checkbox) - click on the runId text
    await user.click(tableView().getByText('run-nav-target'));

    await waitFor(() => {
      expect(screen.getByTestId('location-display').textContent).toBe('/runs/run-nav-target');
    });
  });
});
