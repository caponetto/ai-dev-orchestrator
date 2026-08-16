import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../api/client';
import { renderWithRouter } from '../../../test/render';
import { PermissionApprovalsSection } from '../PermissionApprovalsSection';

vi.mock('../../../api/client', () => ({
  api: {
    fetchPermissionApprovals: vi.fn(),
    deletePermissionApproval: vi.fn(),
    clearPermissionApprovals: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const mockApprovals = [
  {
    id: 'approval-1',
    action: 'shell_execute' as const,
    resource: 'npm test',
    detail: 'Run tests',
    createdAt: '2026-07-20T10:00:00Z',
    createdByRole: 'implementer',
  },
  {
    id: 'approval-2',
    action: 'file_write' as const,
    resource: '/src/main.ts',
    createdAt: '2026-07-21T14:00:00Z',
    createdByRole: 'context_analyst',
  },
];

describe('PermissionApprovalsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders section title', () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue([]);
    renderWithRouter(<PermissionApprovalsSection />);
    expect(screen.getByText('Permission Memory')).toBeInTheDocument();
  });

  it('shows empty state when no approvals exist', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue([]);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText(/No stored approvals yet/)).toBeInTheDocument();
    });
  });

  it('renders approval entries in table', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('Run Command')).toBeInTheDocument();
      expect(screen.getByText('npm test')).toBeInTheDocument();
      expect(screen.getByText('Write File')).toBeInTheDocument();
      expect(screen.getByText('/src/main.ts')).toBeInTheDocument();
    });
  });

  it('shows count of stored approvals', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('2 stored approvals')).toBeInTheDocument();
    });
  });

  it('shows Clear All button when approvals exist', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('Clear All')).toBeInTheDocument();
    });
  });

  it('shows Remove button for each entry', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      const removeButtons = screen.getAllByText('Remove');
      expect(removeButtons).toHaveLength(2);
    });
  });

  it('displays error state', async () => {
    mockedApi.fetchPermissionApprovals.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('removes an entry when Remove button is clicked', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    mockedApi.deletePermissionApproval.mockResolvedValue(undefined);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getAllByText('Remove')).toHaveLength(2);
    });

    const removeButtons = screen.getAllByText('Remove');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(mockedApi.deletePermissionApproval).toHaveBeenCalledWith('approval-1');
      expect(screen.getAllByText('Remove')).toHaveLength(1);
    });
  });

  it('shows error when Remove fails', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    mockedApi.deletePermissionApproval.mockRejectedValue(new Error('Delete failed'));
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getAllByText('Remove')).toHaveLength(2);
    });

    fireEvent.click(screen.getAllByText('Remove')[0]);

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('clears all entries when Clear All button is clicked', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    mockedApi.clearPermissionApprovals.mockResolvedValue(undefined);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('Clear All')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Clear All'));

    await waitFor(() => {
      expect(mockedApi.clearPermissionApprovals).toHaveBeenCalled();
      expect(screen.getByText(/No stored approvals yet/)).toBeInTheDocument();
    });
  });

  it('shows error when Clear All fails', async () => {
    mockedApi.fetchPermissionApprovals.mockResolvedValue(mockApprovals);
    mockedApi.clearPermissionApprovals.mockRejectedValue(new Error('Clear failed'));
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText('Clear All')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Clear All'));

    await waitFor(() => {
      expect(screen.getByText('Clear failed')).toBeInTheDocument();
    });
  });

  it('truncates long resource paths with ellipsis', async () => {
    const longResourceApproval = [
      {
        id: 'approval-long',
        action: 'file_write' as const,
        resource: '/very/long/path/to/some/deeply/nested/directory/structure/file.ts',
        createdAt: '2026-07-21T14:00:00Z',
        createdByRole: 'implementer',
      },
    ];
    mockedApi.fetchPermissionApprovals.mockResolvedValue(longResourceApproval);
    renderWithRouter(<PermissionApprovalsSection />);
    await waitFor(() => {
      expect(screen.getByText(/\.\.\..*file\.ts/)).toBeInTheDocument();
    });
  });
});
