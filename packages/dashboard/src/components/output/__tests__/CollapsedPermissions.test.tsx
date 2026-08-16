// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../../hooks/use-agent-stream';
import { CollapsedPermissions } from '../CollapsedPermissions';
import type { MessageGroup } from '../output-utils';

function permissionLine(
  overrides: Partial<DashboardAgentStreamEvent> = {},
): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'IMPLEMENT',
    roleId: 'code_writer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'stdout',
    content: 'permission resolved',
    protocolMessage: {
      messageType: 'permission_resolved',
      payload: {
        action: 'file_write',
        resolved: 'granted',
        reason: 'previously_approved:policy-1',
        resource: '/src/file.ts',
      },
    },
    ...overrides,
  };
}

function group(line: DashboardAgentStreamEvent): MessageGroup {
  return {
    sender: 'agent',
    senderLabel: 'Code Writer',
    stateId: 'IMPLEMENT',
    lines: [line],
  };
}

describe('CollapsedPermissions', () => {
  it('renders nothing when no permission resolution is present', () => {
    const { container } = render(
      <CollapsedPermissions groups={[group(permissionLine({ protocolMessage: undefined }))]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single permission without the collapsed control', () => {
    render(<CollapsedPermissions groups={[group(permissionLine())]} />);

    expect(screen.getByText(/Write File/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('summarizes and expands previously approved permissions using dispatch labels', async () => {
    const user = userEvent.setup();
    const groups = [
      group(permissionLine()),
      group(
        permissionLine({
          dispatchId: 'dispatch-2',
          timestamp: '2026-01-01T00:00:01Z',
          protocolMessage: {
            messageType: 'permission_resolved',
            payload: {
              action: 'file_write',
              resolved: 'granted',
              reason: 'previously_approved:policy-2',
              resource: '/src/other.ts',
            },
          },
        }),
      ),
    ];

    render(
      <CollapsedPermissions
        groups={groups}
        dispatchLabelMap={new Map([['dispatch-1', 'Writer worker']])}
      />,
    );

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('2 auto-granted to Writer worker');
    expect(button).toHaveTextContent('2× Write File');

    await user.click(button);
    expect(screen.getAllByText(/Write File/)).toHaveLength(3);
    expect(screen.getAllByText(/previously approved/)).toHaveLength(2);
  });

  it('summarizes mixed resolutions and falls back to humanized role names', () => {
    render(
      <CollapsedPermissions
        groups={[
          group(
            permissionLine({
              dispatchId: '',
              roleId: 'test_runner',
              protocolMessage: {
                messageType: 'permission_resolved',
                payload: { action: 'shell_execute', resolved: 'granted', reason: 'policy_match' },
              },
            }),
          ),
          group(
            permissionLine({
              dispatchId: '',
              roleId: 'test_runner',
              protocolMessage: {
                messageType: 'permission_resolved',
                payload: { action: 'unknown_action', resolved: 'denied', reason: 'denied' },
              },
            }),
          ),
        ]}
      />,
    );

    expect(screen.getByRole('button')).toHaveTextContent('2 permissions resolved for Test Runner');
    expect(screen.getByRole('button')).toHaveTextContent('Run Command, unknown_action');
  });
});
