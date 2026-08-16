// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { renderWithRouter } from '../../test/render';
import { PermissionBanner } from '../PermissionBanner';

vi.mock('../../api/client', () => ({
  api: {
    respondPermission: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('PermissionBanner', () => {
  const defaultProps = {
    runId: 'run-1',
    messageId: 'msg-1',
    action: 'file_write',
    resource: '/src/index.ts',
    detail: 'Write to source file',
    riskLevel: 'medium',
  };

  it('renders the action label', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} />);
    expect(screen.getByText('Write File')).toBeInTheDocument();
  });

  it('renders the risk level badge', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} />);
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('renders approve and deny buttons', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('shows resolved state when initially resolved as granted', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} initialResolved="granted" />);
    expect(screen.getByText(/granted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('shows resolved state when initially resolved as denied', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} initialResolved="denied" />);
    expect(screen.getByText(/denied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('displays shell_execute action label', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} action="shell_execute" resource="npm test" />,
    );
    expect(screen.getByText('Run Command')).toBeInTheDocument();
  });

  it('shows previously approved variant with distinct styling', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="granted"
        reason="previously_approved:abc123"
        roleId="context_analyst"
      />,
    );
    expect(screen.getByText(/auto-granted/)).toBeInTheDocument();
    expect(screen.getByText(/previously approved/)).toBeInTheDocument();
    expect(screen.getByText('↻')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('shows normal granted state when reason is not previously_approved', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="granted"
        reason="Auto-approved: high trust"
        roleId="implementer"
      />,
    );
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.queryByText(/previously approved/)).not.toBeInTheDocument();
  });

  it('shows details expanded by default for pending requests', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="shell_execute"
        toolInput={{ command: 'npm test', description: 'Run tests' }}
      />,
    );
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText(/Details/)).toBeInTheDocument();
  });

  it('shows details collapsed for already-resolved requests', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="granted"
        action="shell_execute"
        toolInput={{ command: 'npm test' }}
      />,
    );
    expect(screen.getByText('›')).toBeInTheDocument();
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
  });

  it('collapses details after approving', async () => {
    const user = userEvent.setup();
    vi.mocked(api.respondPermission).mockResolvedValue({ ok: true });

    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="shell_execute"
        toolInput={{ command: 'npm test' }}
      />,
    );

    expect(screen.getByText('npm test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/granted/)).toBeInTheDocument();
    });
    expect(screen.getByText('›')).toBeInTheDocument();
  });

  it('denying sets resolved to denied', async () => {
    const user = userEvent.setup();
    vi.mocked(api.respondPermission).mockResolvedValue({ ok: true });

    renderWithRouter(<PermissionBanner {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(screen.getByText(/denied/)).toBeInTheDocument();
    });
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('renders file_read action label', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} action="file_read" resource="/src/config.ts" />,
    );
    expect(screen.getByText('Read File')).toBeInTheDocument();
  });

  it('renders network action label', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} action="network" resource="https://api.example.com" />,
    );
    expect(screen.getByText('Network Access')).toBeInTheDocument();
  });

  it('falls back to detail when action has no label', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} action="unknown_action" detail="Custom detail" />,
    );
    expect(screen.getByText('Custom detail')).toBeInTheDocument();
  });

  it('shortens long paths', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_write"
        resource="/home/user/project/packages/dashboard/src/components/test.ts"
      />,
    );
    expect(screen.getByText(/packages\/dashboard/)).toBeInTheDocument();
  });

  it('handles low risk level', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} riskLevel="low" />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('handles high risk level', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} riskLevel="high" />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('handles unknown risk level with fallback to medium styling', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} riskLevel="extreme" />);
    expect(screen.getByText('extreme')).toBeInTheDocument();
  });

  it('renders file_write summary with file_path from toolInput', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_write"
        resource=""
        toolInput={{ file_path: '/src/foo.ts', content: 'some content' }}
      />,
    );
    expect(screen.getByText(/Write to/)).toBeInTheDocument();
  });

  it('renders file_read summary with path from toolInput', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_read"
        resource=""
        toolInput={{ path: '/config/settings.json' }}
      />,
    );
    expect(screen.getByText(/settings\.json/)).toBeInTheDocument();
  });

  it('renders shell_execute with description in toolInput', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="shell_execute"
        resource=""
        toolInput={{ command: 'pnpm build', description: 'Build the project' }}
      />,
    );
    expect(screen.getByText(/Build the project/)).toBeInTheDocument();
  });

  it('shows description for file_write when no command', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_write"
        resource="/src/foo.ts"
        toolInput={{ description: 'Update config file' }}
      />,
    );
    expect(screen.getByText('Update config file')).toBeInTheDocument();
  });

  it('toggles details in resolved view', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="granted"
        action="shell_execute"
        toolInput={{ command: 'npm test' }}
      />,
    );
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
    await user.click(screen.getByText('›'));
    expect(screen.getByText('npm test')).toBeInTheDocument();
    await user.click(screen.getByText('›'));
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
  });

  it('toggles details in pending view', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="shell_execute"
        toolInput={{ command: 'npm test' }}
      />,
    );
    expect(screen.getByText('npm test')).toBeInTheDocument();
    await user.click(screen.getByText(/Details/));
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
  });

  it('truncates long content preview', () => {
    const longContent = 'x'.repeat(600);
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_write"
        toolInput={{ content: longContent }}
      />,
    );
    expect(screen.getByText(/…/)).toBeInTheDocument();
  });

  it('resolvedLabel includes roleId when provided', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} initialResolved="denied" roleId="code_reviewer" />,
    );
    expect(screen.getByText(/Code Reviewer/)).toBeInTheDocument();
  });

  it('shortenPath handles short paths without modification', () => {
    renderWithRouter(
      <PermissionBanner {...defaultProps} action="file_write" resource="/src/a.ts" />,
    );
    expect(screen.getByText(/\/src\/a\.ts/)).toBeInTheDocument();
  });

  it('shortenPath falls back to last 3 segments when no marker found', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="file_write"
        resource="/very/deep/nested/path/without/marker/file.ts"
      />,
    );
    expect(screen.getByText(/.+\/marker\/file\.ts/)).toBeInTheDocument();
  });

  it('file_write with no resource or filePath shows fallback', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} action="file_write" resource="" />);
    expect(screen.getByText(/Write file/)).toBeInTheDocument();
  });

  it('file_read with no resource or filePath shows fallback', () => {
    renderWithRouter(<PermissionBanner {...defaultProps} action="file_read" resource="" />);
    expect(screen.getByText(/Read file/)).toBeInTheDocument();
  });

  it('unknown action falls back to resource for summary', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        action="custom_action"
        resource="some-resource"
        detail=""
      />,
    );
    expect(screen.getByText(/some-resource/)).toBeInTheDocument();
  });

  it('shows expired state when reason is agent_finished', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="denied"
        reason="agent_finished"
        roleId="decomposer"
      />,
    );
    expect(screen.getByText(/expired/)).toBeInTheDocument();
    expect(screen.getByText(/agent finished/)).toBeInTheDocument();
    expect(screen.getByText('⊘')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it('expired state includes role name', () => {
    renderWithRouter(
      <PermissionBanner
        {...defaultProps}
        initialResolved="denied"
        reason="agent_finished"
        roleId="context_analyst"
      />,
    );
    expect(screen.getByText(/Context Analyst/)).toBeInTheDocument();
  });
});
