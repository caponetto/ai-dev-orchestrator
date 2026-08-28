// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { server } from '../../test/server';
import { ConfigPanel } from '../ConfigPanel';

const baseConfig = {
  roles: [
    {
      role: 'planner',
      model: 'claude-opus-4-8',
      runner: 'cursor',
    },
    {
      role: 'implementer',
      model: 'claude-opus-4-8',
      runner: 'claude-code',
    },
  ],
  iterationLimits: {},
  qualityGates: {
    specificationReadiness: { minCompletenessScore: 0 },
    implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
  },
  budget: {
    maxTokensPerRun: null,
  },
};

function setupConfigHandler(config: Record<string, unknown> = baseConfig) {
  server.use(http.get('/api/runs/run-1/config', () => HttpResponse.json(config)));
}

describe('ConfigPanel', () => {
  it('renders role, runner, and model columns', async () => {
    setupConfigHandler();
    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);

    expect(await screen.findByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Implementer')).toBeInTheDocument();
  });

  it('renders timeout, max turns, and max tokens columns', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          roles: [
            {
              role: 'developer',
              model: 'claude-sonnet-5',
              runner: 'claude-code',
              timeoutMs: 1200000,
              maxTurns: 25,
              maxTokens: 8192,
            },
          ],
          iterationLimits: {},
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
          },
          budget: { maxTokensPerRun: null },
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);

    expect(await screen.findByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('20m')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Timeout')).toBeInTheDocument();
    expect(screen.getByText('Turns')).toBeInTheDocument();
    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
  });

  it('shows dash for role without runner', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          ...baseConfig,
          roles: [
            {
              role: 'reviewer',
              model: 'claude-opus-4-8',
            },
          ],
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('Reviewer')).toBeInTheDocument();
    // runner column should show dash
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('renders iteration limits when present', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          ...baseConfig,
          iterationLimits: { maxImplementationAttempts: 3, maxReviewCycles: 2 },
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('Iteration Limits')).toBeInTheDocument();
    expect(screen.getByText('Max Implementation Attempts')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders quality gates as separate columns', async () => {
    setupConfigHandler();
    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('Specification Readiness')).toBeInTheDocument();
    expect(screen.getByText('Implementation Review')).toBeInTheDocument();
  });

  it('renders nothing on API error', async () => {
    server.use(http.get('/api/runs/run-1/config', () => HttpResponse.error()));

    const { container } = renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
  });

  it('filters roles by workflowRoles when provided', async () => {
    setupConfigHandler();
    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} workflowRoles={['planner']} />);
    expect(await screen.findByText('Planner')).toBeInTheDocument();
    expect(screen.queryByText('Implementer')).not.toBeInTheDocument();
  });

  it('shows token usage when roleUsage is provided', async () => {
    setupConfigHandler();
    renderWithRouter(
      <ConfigPanel
        runId="run-1"
        roleUsage={[
          {
            role: 'planner',
            inputTokens: 15000,
            outputTokens: 5000,
            dispatches: 1,
            totalDurationMs: 30000,
          },
        ]}
      />,
    );
    expect(await screen.findByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('15.0K')).toBeInTheDocument();
    expect(screen.getByText('5.0K')).toBeInTheDocument();
  });

  it('formats duration with seconds remainder', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          ...baseConfig,
          roles: [
            {
              role: 'tester',
              model: 'claude-sonnet-5',
              runner: 'claude-code',
              timeoutMs: 90000, // 1m 30s
            },
          ],
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('1m 30s')).toBeInTheDocument();
  });

  it('formats duration under a minute in seconds', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          ...baseConfig,
          roles: [
            {
              role: 'tester',
              model: 'claude-sonnet-5',
              runner: 'claude-code',
              timeoutMs: 45000, // 45s
            },
          ],
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('45s')).toBeInTheDocument();
  });

  it('humanizes unknown runner names', async () => {
    server.use(
      http.get('/api/runs/run-1/config', () =>
        HttpResponse.json({
          ...baseConfig,
          roles: [
            {
              role: 'tester',
              model: 'claude-sonnet-5',
              runner: 'custom_runner',
            },
          ],
        }),
      ),
    );

    renderWithRouter(<ConfigPanel runId="run-1" roleUsage={[]} />);
    expect(await screen.findByText('Custom Runner')).toBeInTheDocument();
  });
});
