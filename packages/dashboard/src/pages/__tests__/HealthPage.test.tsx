// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { HealthPage } from '../HealthPage';

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
  http.get('/api/health', () =>
    HttpResponse.json({
      status: 'healthy',
      clients: 3,
      timestamp: '2026-01-15T10:00:00Z',
      uptimeMs: 60_000,
      host: '127.0.0.1',
      port: 9100,
      subsystems: [
        {
          name: 'journal-storage',
          status: 'healthy',
          message: 'Connected',
          lastCheckedAt: '2026-01-15T10:00:00Z',
          consecutiveFailures: 0,
          version: '1.0.0',
        },
      ],
      runStats: {
        total: 10,
        active: 2,
        completed: 7,
        failed: 1,
        avgDurationMs: 45_000,
        latestRun: '2026-01-15T10:00:00Z',
      },
    }),
  ),
);

beforeAll(() => {
  vi.stubGlobal('EventSource', MockEventSource);
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

describe('HealthPage', () => {
  it('renders the heading', () => {
    renderWithRouter(<HealthPage />);
    expect(screen.getByText('System Health')).toBeTruthy();
  });

  it('shows health data after loading', async () => {
    renderWithRouter(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeTruthy();
    });

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('displays subsystem info', async () => {
    renderWithRouter(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText('Journal Storage')).toBeTruthy();
    });

    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows error state when fetch fails', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json({}, { status: 500 })));

    renderWithRouter(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load health/i)).toBeTruthy();
    });
  });
});
