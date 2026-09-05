// @vitest-environment jsdom
import type { ArtifactInventoryView } from '@ai-dev-orchestrator/schemas';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { ArtifactPanel, DEFAULT_VERDICT_COLOR, verdictColorMap } from '../ArtifactPanel';

vi.mock('../../api/client', () => ({
  api: {
    fetchArtifactContent: vi.fn().mockResolvedValue({
      content: '# Test',
      contentType: 'markdown',
      sizeBytes: 10,
    }),
  },
}));

const mockData: ArtifactInventoryView = {
  runId: 'run-1',
  artifacts: [
    {
      ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc123' },
      type: 'plan',
      name: 'plan',
      version: 1,
      producedBy: 'planner',
      sizeBytes: 2048,
      createdAt: '2024-01-01T00:00:00Z',
      verdict: 'approved',
    },
    {
      ref: { type: 'plan', name: 'plan', version: 2, checksum: 'def456' },
      type: 'plan',
      name: 'plan',
      version: 2,
      producedBy: 'planner',
      sizeBytes: 3072,
      createdAt: '2024-01-01T01:00:00Z',
      verdict: 'conditionally_approved',
    },
  ],
  totalCount: 2,
  totalSizeBytes: 5120,
  byType: { plan: 2 },
};

describe('ArtifactPanel', () => {
  it('renders table headers', () => {
    renderWithRouter(<ArtifactPanel data={mockData} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('Last Updated')).toBeInTheDocument();
    expect(screen.getByText('Versions')).toBeInTheDocument();
  });

  it('displays artifact type name', () => {
    renderWithRouter(<ArtifactPanel data={mockData} />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
  });

  it('renders version buttons', () => {
    renderWithRouter(<ArtifactPanel data={mockData} runId="run-1" />);
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  describe('verdictColorMap', () => {
    it('maps approved to green classes', () => {
      expect(verdictColorMap['approved']).toBe('text-green-400 hover:text-green-300');
    });

    it('maps conditionally_approved to yellow classes', () => {
      expect(verdictColorMap['conditionally_approved']).toBe(
        'text-yellow-400 hover:text-yellow-300',
      );
    });

    it('maps rejected to red classes', () => {
      expect(verdictColorMap['rejected']).toBe('text-red-400 hover:text-red-300');
    });

    it('returns undefined for unknown verdicts', () => {
      expect(verdictColorMap['unknown']).toBeUndefined();
    });

    it('has a blue default fallback', () => {
      expect(DEFAULT_VERDICT_COLOR).toBe('text-blue-400 hover:text-blue-300');
    });
  });

  it('applies correct color class for approved verdict', () => {
    renderWithRouter(<ArtifactPanel data={mockData} runId="run-1" />);
    const v1Button = screen.getByText('v1');
    expect(v1Button.className).toContain('text-green-400');
  });

  it('applies correct color class for conditionally approved verdict', () => {
    renderWithRouter(<ArtifactPanel data={mockData} runId="run-1" />);
    const v2Button = screen.getByText('v2');
    expect(v2Button.className).toContain('text-yellow-400');
  });

  it('applies default blue color for unknown verdict', () => {
    const dataWithUnknown: ArtifactInventoryView = {
      ...mockData,
      artifacts: [
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc123' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: 'planner',
          sizeBytes: 2048,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
      totalCount: 1,
      totalSizeBytes: 2048,
    };
    renderWithRouter(<ArtifactPanel data={dataWithUnknown} runId="run-1" />);
    const v1Button = screen.getByText('v1');
    expect(v1Button.className).toContain('text-blue-400');
  });

  it('shows empty state with no artifacts', () => {
    const empty: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [],
      totalCount: 0,
      totalSizeBytes: 0,
      byType: {},
    };
    renderWithRouter(<ArtifactPanel data={empty} />);
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
  });

  it('shows dash for missing producedBy', () => {
    const data: ArtifactInventoryView = {
      ...mockData,
      artifacts: [
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: '',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
      totalCount: 1,
      totalSizeBytes: 100,
    };
    renderWithRouter(<ArtifactPanel data={data} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('opens artifact viewer on version button click when runId is provided', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ArtifactPanel data={mockData} runId="run-1" />);
    await user.click(screen.getByText('v1'));
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });

  it('does not open artifact viewer when runId is not provided', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ArtifactPanel data={mockData} />);
    await user.click(screen.getByText('v1'));
    expect(screen.queryByTestId('artifact-viewer')).not.toBeInTheDocument();
  });

  it('groups multiple artifact types into separate rows', () => {
    const multiTypeData: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: 'planner',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
          verdict: 'approved',
        },
        {
          ref: { type: 'review_report', name: 'review_report', version: 1, checksum: 'def' },
          type: 'review_report',
          name: 'review_report',
          version: 1,
          producedBy: 'reviewer',
          sizeBytes: 200,
          createdAt: '2024-01-01T02:00:00Z',
          verdict: 'rejected',
        },
      ],
      totalCount: 2,
      totalSizeBytes: 300,
      byType: { plan: 1, review_report: 1 },
    };
    renderWithRouter(<ArtifactPanel data={multiTypeData} runId="run-1" />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Review Report')).toBeInTheDocument();
  });

  it('deduplicates versions with the same version number', () => {
    const dupData: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: 'planner',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'def' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: 'planner',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
      totalCount: 2,
      totalSizeBytes: 200,
      byType: { plan: 2 },
    };
    renderWithRouter(<ArtifactPanel data={dupData} runId="run-1" />);
    const buttons = screen.getAllByText('v1');
    expect(buttons).toHaveLength(1);
  });

  it('sorts groups by earliest createdAt date', () => {
    const sortData: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [
        {
          ref: { type: 'review_report', name: 'review_report', version: 1, checksum: 'def' },
          type: 'review_report',
          name: 'review_report',
          version: 1,
          producedBy: 'reviewer',
          sizeBytes: 200,
          createdAt: '2024-01-02T00:00:00Z',
        },
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: 'planner',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
      totalCount: 2,
      totalSizeBytes: 300,
      byType: { plan: 1, review_report: 1 },
    };
    renderWithRouter(<ArtifactPanel data={sortData} runId="run-1" />);
    const rows = screen.getAllByRole('row');
    // First data row (after header) should be Plan (earlier date)
    expect(rows[1]).toHaveTextContent('Plan');
    expect(rows[2]).toHaveTextContent('Review Report');
  });

  it('fills producedBy from later artifact when first has empty producedBy', () => {
    const data: ArtifactInventoryView = {
      runId: 'run-1',
      artifacts: [
        {
          ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
          type: 'plan',
          name: 'plan',
          version: 1,
          producedBy: '',
          sizeBytes: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          ref: { type: 'plan', name: 'plan', version: 2, checksum: 'def' },
          type: 'plan',
          name: 'plan',
          version: 2,
          producedBy: 'planner',
          sizeBytes: 100,
          createdAt: '2024-01-01T01:00:00Z',
        },
      ],
      totalCount: 2,
      totalSizeBytes: 200,
      byType: { plan: 2 },
    };
    renderWithRouter(<ArtifactPanel data={data} />);
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });
});
