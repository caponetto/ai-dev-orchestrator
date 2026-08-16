// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../../hooks/use-agent-stream';
import type { DispatchArtifacts } from '../../../lib/dispatch-artifacts';
import { ChatBubble } from '../ChatBubble';

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'REVIEW',
    roleId: 'review_findings_writer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:01Z',
    type: 'stdout',
    content: 'Producing review findings...',
    ...overrides,
  };
}

const scrollRef = React.createRef<HTMLDivElement>();

const defaultProps = {
  runId: 'run-1',
  seenTimestamps: new Set<string>(['2026-01-01T00:00:01Z']),
  scrollContainer: scrollRef,
  roleMetaMap: new Map(),
  dispatchPromptMap: new Map(),
  respondedRequestIds: new Map(),
} as const;

describe('ChatBubble artifact output display', () => {
  it('shows output artifacts when dispatch has produced them (no done event in group)', async () => {
    const user = userEvent.setup();

    const artifactMap = new Map<string, DispatchArtifacts>([
      [
        'review_findings_writer\0dispatch-1',
        {
          inputs: [
            { type: 'review_report', name: 'report', version: 1, checksum: 'a' },
            { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'b' },
          ],
          outputs: [{ type: 'review_findings', name: 'findings', version: 1, checksum: 'c' }],
        },
      ],
    ]);

    const group = {
      sender: 'agent' as const,
      senderLabel: 'Review Findings Writer',
      stateId: 'REVIEW',
      lines: [makeLine()],
    };

    render(
      <ChatBubble
        {...defaultProps}
        group={group}
        dispatchArtifactMap={artifactMap}
        historicalArtifactMap={new Map()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'View artifacts' });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByText('Review Findings v1')).toBeInTheDocument();
    expect(screen.getByText('Review Report v1')).toBeInTheDocument();
    expect(screen.getByText('Canonical Specification v1')).toBeInTheDocument();
    expect(screen.queryByText('Not produced yet')).not.toBeInTheDocument();
  });

  it('shows "Not produced yet" when no output artifacts exist yet', async () => {
    const user = userEvent.setup();

    const artifactMap = new Map<string, DispatchArtifacts>([
      [
        'review_findings_writer\0dispatch-1',
        {
          inputs: [{ type: 'review_report', name: 'report', version: 1, checksum: 'a' }],
          outputs: [],
        },
      ],
    ]);

    const group = {
      sender: 'agent' as const,
      senderLabel: 'Review Findings Writer',
      stateId: 'REVIEW',
      lines: [makeLine()],
    };

    render(
      <ChatBubble
        {...defaultProps}
        group={group}
        dispatchArtifactMap={artifactMap}
        historicalArtifactMap={new Map()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View artifacts' }));

    expect(screen.getByText('Not produced yet')).toBeInTheDocument();
  });

  it('shows outputs even when system events split the group (done event absent)', async () => {
    const user = userEvent.setup();

    const artifactMap = new Map<string, DispatchArtifacts>([
      [
        'review_findings_writer\0dispatch-1',
        {
          inputs: [{ type: 'canonical_specification', name: 'spec', version: 1, checksum: 'a' }],
          outputs: [{ type: 'review_findings', name: 'findings', version: 1, checksum: 'c' }],
        },
      ],
    ]);

    const groupWithoutDone = {
      sender: 'agent' as const,
      senderLabel: 'Review Findings Writer',
      stateId: 'REVIEW',
      lines: [
        makeLine({ content: 'Analyzing reviews...' }),
        makeLine({
          timestamp: '2026-01-01T00:00:02Z',
          content: 'Writing findings...',
        }),
      ],
    };

    render(
      <ChatBubble
        {...defaultProps}
        seenTimestamps={new Set(['2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z'])}
        group={groupWithoutDone}
        dispatchArtifactMap={artifactMap}
        historicalArtifactMap={new Map()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View artifacts' }));

    expect(screen.getByText('Review Findings v1')).toBeInTheDocument();
    expect(screen.queryByText('Not produced yet')).not.toBeInTheDocument();
  });

  it('does not render popover for orchestrator groups', () => {
    const artifactMap = new Map<string, DispatchArtifacts>([
      [
        'orchestrator\0dispatch-1',
        {
          inputs: [{ type: 'plan', name: 'p', version: 1, checksum: 'x' }],
          outputs: [],
        },
      ],
    ]);

    const group = {
      sender: 'orchestrator' as const,
      senderLabel: 'AI Dev Orchestrator',
      stateId: 'REVIEW',
      lines: [
        makeLine({
          roleId: 'orchestrator',
          protocolMessage: {
            messageType: 'task_prompt' as const,
            payload: {},
          },
        }),
      ],
    };

    render(
      <ChatBubble
        {...defaultProps}
        group={group}
        dispatchArtifactMap={artifactMap}
        historicalArtifactMap={new Map()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'View artifacts' })).not.toBeInTheDocument();
  });

  it('does not render popover when no artifacts are resolved', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Review Findings Writer',
      stateId: 'REVIEW',
      lines: [makeLine()],
    };

    render(
      <ChatBubble
        {...defaultProps}
        group={group}
        dispatchArtifactMap={new Map()}
        historicalArtifactMap={new Map()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'View artifacts' })).not.toBeInTheDocument();
  });
});
