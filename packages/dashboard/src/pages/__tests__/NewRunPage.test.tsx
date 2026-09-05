// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { NewRunPage } from '../NewRunPage';

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
  http.get('/api/runs', () => HttpResponse.json([])),
  http.get('/api/workflows', () =>
    HttpResponse.json([
      { name: 'dev', version: '1', stateCount: 3 },
      { name: 'ci', version: '2', stateCount: 5 },
    ]),
  ),
  http.get('/api/workflows/:name/preview', () =>
    HttpResponse.json({
      runId: '',
      states: [],
      transitions: [],
      currentState: '',
      visitedStates: [],
      stateHistory: [],
    }),
  ),
  http.get('/api/settings', () =>
    HttpResponse.json({
      roles: { assignments: {} },
      governance: {
        permissionPolicy: { defaultAction: 'ask_human' },
        iterationLimits: { defaults: {} },
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
        },
        budget: {},
      },
      runtime: { logLevel: 'info' },
      availableRunners: [],
      modelsByRunner: {},
    }),
  ),
  http.get('/api/server-info', () => HttpResponse.json({ cwd: '/tmp/test-repo' })),
);

beforeAll(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  Element.prototype.scrollIntoView = vi.fn();
  server.listen({ onUnhandledRequest: 'bypass' });
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});

function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/new']}>
      <Routes>
        <Route path="/new" element={<NewRunPage />} />
        <Route path="/runs/:runId" element={<div data-testid="run-detail">Run Detail</div>} />
        <Route path="/runs" element={<div data-testid="runs-list">Runs List</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NewRunPage', () => {
  it('renders the heading and form elements', () => {
    renderWithRouter(<NewRunPage />);

    expect(screen.getByText('New Run')).toBeTruthy();
    expect(screen.getByText(/Describe the task/i)).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('renders the Start Run button as disabled initially', () => {
    renderWithRouter(<NewRunPage />);

    const startButton = screen.getByText('Start Run');
    expect(startButton).toBeTruthy();
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows workflow selector after loading', async () => {
    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      expect(screen.getByText(/dev \(v1\)/)).toBeTruthy();
    });
  });

  it('shows repository context input', () => {
    renderWithRouter(<NewRunPage />);
    expect(screen.getByPlaceholderText('Defaults to system temp directory')).toBeTruthy();
  });

  it('shows prompt textarea', () => {
    renderWithRouter(<NewRunPage />);
    expect(screen.getByPlaceholderText('Describe the task...')).toBeTruthy();
  });

  it('keeps Start Run disabled for empty or whitespace-only prompt', () => {
    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    const startButton = screen.getByText('Start Run');

    expect((startButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: '   ' } });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('navigates to the new run when createRun returns a runId', async () => {
    server.use(
      http.post('/api/runs', () => HttpResponse.json({ success: true, runId: 'new-run-1' })),
    );

    renderWithRoutes();

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail')).toBeTruthy();
    });
  });

  it('shows pending UI when createRun succeeds without a runId', async () => {
    server.use(http.post('/api/runs', () => HttpResponse.json({ success: true })));

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Starting run...')).toBeTruthy();
    });
    expect(screen.getByText('Waiting for the orchestrator to initialize')).toBeTruthy();
  });

  it('shows error when createRun returns failure', async () => {
    server.use(
      http.post('/api/runs', () => HttpResponse.json({ success: false, error: 'some error' })),
    );

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('some error')).toBeTruthy();
    });
  });

  it('shows error when createRun throws an exception', async () => {
    server.use(
      http.post('/api/runs', () =>
        HttpResponse.json({ error: 'Server exploded' }, { status: 500 }),
      ),
    );

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Server exploded')).toBeTruthy();
    });
  });

  it('shows failed state with Back to Runs button after timeout', async () => {
    server.use(http.post('/api/runs', () => HttpResponse.json({ success: true })));

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Starting run...')).toBeTruthy();
    });

    await act(() => vi.advanceTimersByTimeAsync(15_000));

    await waitFor(() => {
      expect(screen.getByText('Run failed to start')).toBeTruthy();
    });
    expect(screen.getByText('Back to Runs')).toBeTruthy();
  });

  it('pre-fills repository context from server info', async () => {
    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Defaults to system temp directory');
      expect((input as HTMLInputElement).value).toBe('/tmp/test-repo');
    });
  });

  it('shows "Starting..." text while submitting', async () => {
    server.use(
      http.post('/api/runs', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ success: true, runId: 'new-run-1' });
      }),
    );

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Starting...')).toBeTruthy();
    });
  });

  it('shows clear button when repoRoot is set and clears on click', async () => {
    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Defaults to system temp directory');
      expect((input as HTMLInputElement).value).toBe('/tmp/test-repo');
    });

    const clearButton = screen.getByLabelText('Clear repository context');
    expect(clearButton).toBeTruthy();

    fireEvent.click(clearButton);

    const input = screen.getByPlaceholderText('Defaults to system temp directory');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('browse directory success sets repoRoot', async () => {
    server.use(
      http.get('/api/browse-directory', () => HttpResponse.json({ path: '/new/selected/path' })),
    );

    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Defaults to system temp directory');
      expect((input as HTMLInputElement).value).toBe('/tmp/test-repo');
    });

    const browseButton = screen.getByTitle('Browse for folder');
    fireEvent.click(browseButton);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Defaults to system temp directory');
      expect((input as HTMLInputElement).value).toBe('/new/selected/path');
    });
  });

  it('browse directory returns null path', async () => {
    server.use(http.get('/api/browse-directory', () => HttpResponse.json({ path: null })));

    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Defaults to system temp directory');
      expect((input as HTMLInputElement).value).toBe('/tmp/test-repo');
    });

    const browseButton = screen.getByTitle('Browse for folder');
    fireEvent.click(browseButton);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const input = screen.getByPlaceholderText('Defaults to system temp directory');
    expect((input as HTMLInputElement).value).toBe('/tmp/test-repo');
  });

  it('clears error status when typing in prompt', async () => {
    server.use(
      http.post('/api/runs', () =>
        HttpResponse.json({ success: false, error: 'validation error' }),
      ),
    );

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('validation error')).toBeTruthy();
    });

    fireEvent.change(textarea, { target: { value: 'Build a different feature' } });

    await waitFor(() => {
      expect(screen.queryByText('validation error')).toBeNull();
    });
  });

  it('cancel button navigates to runs', async () => {
    renderWithRoutes();

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.getByTestId('runs-list')).toBeTruthy();
    });
  });

  it('settings panel toggle', async () => {
    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      expect(screen.getByText('Run Configuration')).toBeTruthy();
    });

    const configButton = screen.getByText('Run Configuration');
    fireEvent.click(configButton);

    await waitFor(() => {
      expect(screen.getByText('Iteration Limits')).toBeTruthy();
    });
  });

  it('submit with dirty settings that fail to save', async () => {
    server.use(
      http.post('/api/runs', () => HttpResponse.json({ success: false, error: 'save failed' })),
    );

    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      expect(screen.getByText('Run Configuration')).toBeTruthy();
    });

    const configButton = screen.getByText('Run Configuration');
    fireEvent.click(configButton);

    await waitFor(() => {
      expect(screen.getByText('Iteration Limits')).toBeTruthy();
    });

    const logLevelLabel = screen.getByText('Log Level');
    const logLevelSelect = logLevelLabel.closest('label')?.querySelector('select');
    expect(logLevelSelect).toBeTruthy();
    fireEvent.change(logLevelSelect as Element, { target: { value: 'debug' } });

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('save failed')).toBeTruthy();
    });
  });

  it('includes runSettings in createRun request', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/runs', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, runId: 'new-run-1' });
      }),
    );

    renderWithRouter(<NewRunPage />);

    await waitFor(() => {
      expect(screen.getByText('Run Configuration')).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
    });
    expect(capturedBody?.['prompt']).toBe('Build a feature');
    expect(capturedBody?.['runSettings']).toEqual({
      roles: { assignments: {} },
      governance: {
        permissionPolicy: { defaultAction: 'ask_human' },
        iterationLimits: { defaults: {} },
        qualityGates: {
          specificationReadiness: { minCompletenessScore: 0 },
          implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
        },
        budget: {},
      },
      runtime: { logLevel: 'info' },
    });
  });

  it('createRun failure without error message', async () => {
    server.use(http.post('/api/runs', () => HttpResponse.json({ success: false })));

    renderWithRouter(<NewRunPage />);

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to create run')).toBeTruthy();
    });
  });

  it('pending state navigates when new run appears', async () => {
    let callCount = 0;
    server.use(
      http.post('/api/runs', () => HttpResponse.json({ success: true })),
      http.get('/api/runs', () => {
        callCount++;
        if (callCount > 2) {
          return HttpResponse.json([
            {
              runId: 'pending-run-1',
              repository: 'test-repo',
              workflow: 'dev',
              status: 'running',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: 1000,
              totalArtifacts: 0,
              totalTokens: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              finalState: '',
            },
          ]);
        }
        return HttpResponse.json([]);
      }),
    );

    renderWithRoutes();

    const textarea = screen.getByPlaceholderText('Describe the task...');
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });

    const startButton = screen.getByText('Start Run');
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText('Starting run...')).toBeTruthy();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail')).toBeTruthy();
    });
  });
});
