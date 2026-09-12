// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../../hooks/use-agent-stream';
import { consolidateToolCalls, ToolActivityBlock } from '../ToolActivityBlock';

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'INTAKE',
    roleId: 'requirements_analyst',
    dispatchId: 'dispatch-1',
    timestamp: '2026-09-12T16:05:00.000Z',
    type: 'status',
    content: 'read',
    ...overrides,
  };
}

describe('consolidateToolCalls', () => {
  it('returns empty array when lines have no tool calls', () => {
    const lines = [makeLine({ content: 'just text', structuredData: {} })];
    expect(consolidateToolCalls(lines)).toEqual([]);
  });

  it('consolidates single tool call and result into one completed entry', () => {
    const lines = [
      makeLine({
        timestamp: '2026-09-12T16:05:00.000Z',
        structuredData: { phase: 'tool_call', detail: 'read' },
      }),
      makeLine({
        timestamp: '2026-09-12T16:05:01.000Z',
        structuredData: { phase: 'tool_result', detail: 'read' },
      }),
    ];
    const result = consolidateToolCalls(lines);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('read');
    expect(result[0]?.phase).toBe('tool_result');
    expect(result[0]?.timestamp).toBe('2026-09-12T16:05:01.000Z');
  });

  it('handles multiple tool executions', () => {
    const lines = [
      makeLine({
        timestamp: '2026-09-12T16:05:00.000Z',
        structuredData: { phase: 'tool_result', detail: 'read' },
      }),
      makeLine({
        timestamp: '2026-09-12T16:05:05.000Z',
        structuredData: { phase: 'tool_result', detail: 'glob' },
      }),
      makeLine({
        timestamp: '2026-09-12T16:05:10.000Z',
        structuredData: { phase: 'tool_call', detail: 'grep' },
      }),
    ];
    const result = consolidateToolCalls(lines);
    expect(result).toHaveLength(3);
    expect(result[0]?.name).toBe('read');
    expect(result[1]?.name).toBe('glob');
    expect(result[2]?.name).toBe('grep');
    expect(result[2]?.phase).toBe('tool_call');
  });
});

describe('ToolActivityBlock', () => {
  it('renders summary title for single tool call with detail', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [
        makeLine({
          structuredData: { phase: 'tool_result', detail: 'read packages/schemas/src/index.ts' },
        }),
      ],
    };

    render(<ToolActivityBlock group={group} />);
    expect(screen.getByText('Used tool read (packages/schemas/src/index.ts)')).toBeInTheDocument();
  });

  it('renders summary title for single tool call without detail', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [
        makeLine({
          structuredData: { phase: 'tool_result', detail: 'read' },
        }),
      ],
    };

    render(<ToolActivityBlock group={group} />);
    expect(screen.getByText('Used tool read')).toBeInTheDocument();
  });

  it('renders summary title with counts for multiple tools', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [
        makeLine({
          timestamp: '2026-09-12T16:05:00.000Z',
          structuredData: { phase: 'tool_result', detail: 'read' },
        }),
        makeLine({
          timestamp: '2026-09-12T16:05:02.000Z',
          structuredData: { phase: 'tool_result', detail: 'read' },
        }),
        makeLine({
          timestamp: '2026-09-12T16:05:05.000Z',
          structuredData: { phase: 'tool_result', detail: 'glob' },
        }),
      ],
    };

    render(<ToolActivityBlock group={group} />);
    expect(screen.getByText(/Used 3 tools \(2× read, glob\)/i)).toBeInTheDocument();
  });

  it('shows worker label when dispatchLabelMap is provided', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [
        makeLine({
          dispatchId: 'worker-1',
          roleId: 'requirements_analyst',
          structuredData: { phase: 'tool_result', detail: 'read' },
        }),
      ],
    };
    const dispatchLabelMap = new Map([['worker-1', 'Requirements Analyst #1']]);

    render(<ToolActivityBlock group={group} dispatchLabelMap={dispatchLabelMap} />);
    expect(screen.getByText('Requirements Analyst #1:')).toBeInTheDocument();
  });

  it('expands and collapses tool details on click', async () => {
    const user = userEvent.setup();
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [
        makeLine({
          timestamp: '2026-09-12T16:05:00.000Z',
          structuredData: { phase: 'tool_result', detail: 'read' },
        }),
        makeLine({
          timestamp: '2026-09-12T16:05:05.000Z',
          structuredData: { phase: 'tool_call', detail: 'grep' },
        }),
      ],
    };

    render(<ToolActivityBlock group={group} />);

    // Initially collapsed
    expect(screen.queryByText('running...')).not.toBeInTheDocument();
    expect(screen.queryByText('done')).not.toBeInTheDocument();

    // Click button to expand
    const button = screen.getByRole('button');
    await user.click(button);

    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('running...')).toBeInTheDocument();

    // Click again to collapse
    await user.click(button);
    expect(screen.queryByText('running...')).not.toBeInTheDocument();
  });

  it('returns null when no valid tool calls in lines', () => {
    const group = {
      sender: 'agent' as const,
      senderLabel: 'Requirements Analyst',
      isToolActivity: true,
      lines: [makeLine({ content: 'no tool info', structuredData: {} })],
    };

    const { container } = render(<ToolActivityBlock group={group} />);
    expect(container.firstChild).toBeNull();
  });
});
