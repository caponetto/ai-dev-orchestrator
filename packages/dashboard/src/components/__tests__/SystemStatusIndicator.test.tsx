// @vitest-environment jsdom
import type { HealthResponse } from '@ai-dev-orchestrator/schemas';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SseStatus } from '../../hooks/use-event-stream';
import { renderWithRouter } from '../../test/render';
import { computeCompositeStatus, SystemStatusIndicator } from '../SystemStatusIndicator';

function healthyResponse(): HealthResponse {
  return {
    status: 'healthy',
    clients: 1,
    timestamp: '2026-01-15T10:00:00Z',
    subsystems: [
      {
        name: 'journal-storage',
        status: 'healthy',
        message: 'OK',
        lastCheckedAt: '2026-01-15T10:00:00Z',
        consecutiveFailures: 0,
      },
    ],
  };
}

function degradedResponse(): HealthResponse {
  return {
    status: 'degraded',
    clients: 1,
    timestamp: '2026-01-15T10:00:00Z',
    subsystems: [
      {
        name: 'journal-storage',
        status: 'degraded',
        message: 'Slow',
        lastCheckedAt: '2026-01-15T10:00:00Z',
        consecutiveFailures: 2,
      },
    ],
  };
}

function unhealthyResponse(): HealthResponse {
  return {
    status: 'unhealthy',
    clients: 1,
    timestamp: '2026-01-15T10:00:00Z',
    subsystems: [
      {
        name: 'runner:claude-code',
        status: 'unhealthy',
        message: 'Down',
        lastCheckedAt: '2026-01-15T10:00:00Z',
        consecutiveFailures: 5,
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

const server = setupServer(http.get('/api/health', () => HttpResponse.json(healthyResponse())));

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

describe('computeCompositeStatus', () => {
  it('returns disconnected when SSE is disconnected', () => {
    expect(computeCompositeStatus('disconnected', healthyResponse())).toBe('disconnected');
  });

  it('returns reconnecting when SSE is reconnecting', () => {
    expect(computeCompositeStatus('reconnecting', healthyResponse())).toBe('reconnecting');
  });

  it('returns healthy when SSE is connected but health is null', () => {
    expect(computeCompositeStatus('connected', null)).toBe('healthy');
  });

  it('returns healthy when SSE connected and health healthy', () => {
    expect(computeCompositeStatus('connected', healthyResponse())).toBe('healthy');
  });

  it('returns healthy when health status is ok', () => {
    expect(computeCompositeStatus('connected', { ...healthyResponse(), status: 'ok' })).toBe(
      'healthy',
    );
  });

  it('returns degraded when SSE connected and health degraded', () => {
    expect(computeCompositeStatus('connected', degradedResponse())).toBe('degraded');
  });

  it('returns unhealthy when SSE connected and health unhealthy', () => {
    expect(computeCompositeStatus('connected', unhealthyResponse())).toBe('unhealthy');
  });

  it('SSE disconnected overrides healthy health', () => {
    expect(computeCompositeStatus('disconnected', healthyResponse())).toBe('disconnected');
  });

  it('SSE reconnecting overrides unhealthy health', () => {
    expect(computeCompositeStatus('reconnecting', unhealthyResponse())).toBe('reconnecting');
  });
});

describe('SystemStatusIndicator', () => {
  function renderIndicator(sseStatus: SseStatus, dotOnly?: boolean) {
    return renderWithRouter(<SystemStatusIndicator sseStatus={sseStatus} dotOnly={dotOnly} />);
  }

  it('shows "Healthy" when connected and healthy', async () => {
    renderIndicator('connected');

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });
  });

  it('shows "Healthy" optimistically before health loads', () => {
    server.use(http.get('/api/health', () => new Promise(() => {})));
    renderIndicator('connected');
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows "Degraded" when health is degraded', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json(degradedResponse())));
    renderIndicator('connected');

    await waitFor(() => {
      expect(screen.getByText('Degraded')).toBeInTheDocument();
    });
  });

  it('shows "Unhealthy" when health is unhealthy', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json(unhealthyResponse())));
    renderIndicator('connected');

    await waitFor(() => {
      expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    });
  });

  it('shows "Reconnecting" when SSE is reconnecting', () => {
    renderIndicator('reconnecting');
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('shows "Disconnected" when SSE is disconnected', () => {
    renderIndicator('disconnected');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders a colored dot', async () => {
    const { container } = renderIndicator('connected');

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
  });

  it('renders as a link to /health', async () => {
    renderIndicator('connected');

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    const link = screen.getByRole('status').closest('a');
    expect(link).toHaveAttribute('href', '/health');
  });

  describe('dotOnly mode', () => {
    it('hides the label text', () => {
      renderIndicator('connected', true);
      expect(screen.queryByText('Connected')).not.toBeInTheDocument();
      expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    });

    it('still renders the dot', () => {
      const { container } = renderIndicator('connected', true);
      const dot = container.querySelector('.rounded-full');
      expect(dot).toBeInTheDocument();
    });

    it('has an aria-label with status breakdown', () => {
      renderIndicator('disconnected', true);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Disconnected');
    });
  });
});
