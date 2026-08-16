// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import { renderWithRouter } from '../../test/render';
import { AgentOutputPanel, PromptModal } from '../output';

vi.mock('../../api/client', () => ({
  api: {
    respondPermission: vi.fn().mockResolvedValue(undefined),
    respondAction: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'state-1',
    roleId: 'reviewer',
    dispatchId: 'dispatch-1',
    timestamp: '2024-01-01T00:00:00Z',
    type: 'stdout',
    content: 'test output',
    ...overrides,
  };
}

function makeGroups(
  lines: DashboardAgentStreamEvent[],
  dispatchId = 'dispatch-1',
  roleId = 'reviewer',
): Map<
  string,
  { dispatchId: string; roleId: string; stateId: string; lines: DashboardAgentStreamEvent[] }
> {
  const map = new Map<
    string,
    { dispatchId: string; roleId: string; stateId: string; lines: DashboardAgentStreamEvent[] }
  >();
  map.set(dispatchId, {
    dispatchId,
    roleId,
    stateId: lines[0]?.stateId ?? 'state-1',
    lines,
  });
  return map;
}

describe('AgentOutputPanel', () => {
  it('renders the waiting message when empty', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="connected" />);
    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows waiting message when no output', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="connected" />);
    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows reconnecting indicator', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="reconnecting" />);
    expect(screen.getByText('reconnecting...')).toBeInTheDocument();
  });

  it('shows disconnected indicator', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="disconnected" />);
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('renders sources when provided', () => {
    renderWithRouter(
      <AgentOutputPanel groups={new Map()} status="connected" sources={['Build a new feature']} />,
    );
    expect(screen.getByText('Human')).toBeInTheDocument();
    expect(screen.getByText('Build a new feature')).toBeInTheDocument();
  });

  it('does not render sources section when sources is empty', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="connected" sources={[]} />);
    expect(screen.queryByText('Human')).not.toBeInTheDocument();
  });

  it('renders abort message for aborted run', () => {
    const lines = [
      makeLine({
        structuredData: { action: 'aborted', reason: 'User aborted' },
      }),
    ];
    const groups = makeGroups(lines);
    renderWithRouter(
      <AgentOutputPanel
        groups={groups}
        status="connected"
        isRunActive={false}
        runStatus="aborted"
      />,
    );
    expect(screen.getByText('Aborted the run')).toBeInTheDocument();
    expect(screen.getByText('Human')).toBeInTheDocument();
  });

  it('attributes workflow failure abort to orchestrator, not human', () => {
    const lines = [
      makeLine({
        roleId: 'script',
        type: 'stderr',
        content: 'No review findings artifact found\n',
        structuredData: undefined,
      }),
      makeLine({
        roleId: 'script',
        structuredData: {
          messageType: 'script_completed',
          script: 'upload-findings-gist.ts',
          exitCode: 1,
        },
      }),
    ];
    const groups = makeGroups(lines);
    renderWithRouter(
      <AgentOutputPanel
        groups={groups}
        status="connected"
        isRunActive={false}
        runStatus="aborted"
      />,
    );
    expect(screen.getByText('Run aborted')).toBeInTheDocument();
    expect(screen.getByText('AI Dev Orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('Aborted the run')).not.toBeInTheDocument();
  });

  it('shows interrupted message for interrupted run', () => {
    const lines = [makeLine()];
    const groups = makeGroups(lines);
    renderWithRouter(
      <AgentOutputPanel
        groups={groups}
        status="connected"
        isRunActive={false}
        runStatus="interrupted"
      />,
    );
    expect(screen.getByText('Run was interrupted')).toBeInTheDocument();
  });

  it('does not show abort message when run is active', () => {
    const lines = [makeLine()];
    const groups = makeGroups(lines);
    renderWithRouter(
      <AgentOutputPanel groups={groups} status="connected" isRunActive runStatus="aborted" />,
    );
    expect(screen.queryByText('Aborted the run')).not.toBeInTheDocument();
  });

  it('shows debug toggle when debug messages exist', async () => {
    const user = userEvent.setup();
    const lines = [
      makeLine({
        protocolMessage: {
          messageType: 'log',
          payload: { level: 'debug', message: 'debug-info' },
        },
        content: JSON.stringify({
          protocol: 'agent-protocol',
          type: 'log',
          level: 'debug',
          message: 'debug-info',
        }),
      }),
    ];
    const groups = makeGroups(lines);
    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive />);
    const toggle = screen.getByText('Show debug');
    expect(toggle).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('Hide debug')).toBeInTheDocument();
  });

  it('does not show debug toggle when no debug messages', () => {
    const lines = [makeLine()];
    const groups = makeGroups(lines);
    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive />);
    expect(screen.queryByText('Show debug')).not.toBeInTheDocument();
  });

  it('renders script dispatch as ScriptOutputBlock', () => {
    const lines = [
      makeLine({
        dispatchId: 'script-1',
        roleId: 'script',
        type: 'stdout',
        content: 'npm test output',
        structuredData: { messageType: 'script_started', script: 'test.sh' },
      }),
      makeLine({
        dispatchId: 'script-1',
        roleId: 'script',
        type: 'stdout',
        content: 'All tests passed',
        structuredData: {
          messageType: 'script_completed',
          script: 'test.sh',
          exitCode: 0,
          durationMs: 1500,
        },
      }),
    ];
    const groups = makeGroups(lines, 'script-1', 'script');
    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive={false} />);
    expect(screen.getByText('test.sh')).toBeInTheDocument();
  });

  it('renders script block with state name', () => {
    const lines = [
      makeLine({
        dispatchId: 'script-2',
        stateId: 'publish_findings',
        roleId: 'script',
        type: 'stdout',
        content: '',
        structuredData: { messageType: 'script_started', script: 'upload.ts' },
      }),
      makeLine({
        dispatchId: 'script-2',
        stateId: 'publish_findings',
        roleId: 'script',
        type: 'stdout',
        content: 'Done',
        structuredData: {
          messageType: 'script_completed',
          script: 'upload.ts',
          exitCode: 0,
          durationMs: 800,
        },
      }),
    ];
    const groups = makeGroups(lines, 'script-2', 'script');
    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive={false} />);
    expect(screen.getByText('@ Publish Findings')).toBeInTheDocument();
  });

  it('shows structured message in script block without duplication', () => {
    const lines = [
      makeLine({
        dispatchId: 'script-3',
        roleId: 'script',
        type: 'stdout',
        content: '',
        structuredData: { messageType: 'script_started', script: 'upload-findings-gist.ts' },
      }),
      makeLine({
        dispatchId: 'script-3',
        roleId: 'script',
        type: 'stdout',
        content: 'Findings published to: https://gist.github.com/test/abc',
        structuredData: {
          messageType: 'script_completed',
          script: 'upload-findings-gist.ts',
          exitCode: 0,
          durationMs: 1200,
          display: { message: 'Findings published to: https://gist.github.com/test/abc' },
        },
      }),
    ];
    const groups = makeGroups(lines, 'script-3', 'script');
    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive={false} />);
    const links = screen.getAllByRole('link', { name: 'https://gist.github.com/test/abc' });
    expect(links).toHaveLength(1);
  });

  it('does not show waiting text when sources are present and lines are empty', () => {
    renderWithRouter(
      <AgentOutputPanel groups={new Map()} status="connected" sources={['Some prompt']} />,
    );
    expect(screen.queryByText('Waiting for output...')).not.toBeInTheDocument();
  });

  it('renders connected state without status bar', () => {
    renderWithRouter(<AgentOutputPanel groups={new Map()} status="connected" />);
    expect(screen.queryByText('reconnecting...')).not.toBeInTheDocument();
    expect(screen.queryByText('disconnected')).not.toBeInTheDocument();
  });

  it('shows output artifacts in popover when system events split the agent group', async () => {
    const user = userEvent.setup();

    const taskPromptLine = makeLine({
      roleId: 'orchestrator',
      dispatchId: 'dispatch-2',
      stateId: 'WRAP_UP',
      timestamp: '2026-01-01T00:00:00Z',
      type: 'status',
      content: 'Dispatching review_findings_writer',
      structuredData: {
        messageType: 'task_prompt',
        sender: 'orchestrator',
        inputArtifacts: [{ type: 'review_report', name: 'report', version: 1, checksum: 'a' }],
      },
    });

    const agentOutputLine = makeLine({
      roleId: 'review_findings_writer',
      dispatchId: 'dispatch-2',
      stateId: 'WRAP_UP',
      timestamp: '2026-01-01T00:00:01Z',
      content: 'Producing findings...',
    });

    const permissionLine = makeLine({
      roleId: 'review_findings_writer',
      dispatchId: 'dispatch-2',
      stateId: 'WRAP_UP',
      timestamp: '2026-01-01T00:00:02Z',
      type: 'status',
      content: '',
      protocolMessage: {
        messageType: 'permission_resolved',
        payload: {
          action: 'file_write',
          resolved: 'granted',
          reason: 'previously_approved',
        },
      },
    });

    const artifactProducedLine = makeLine({
      roleId: 'review_findings_writer',
      dispatchId: 'dispatch-2',
      stateId: 'WRAP_UP',
      timestamp: '2026-01-01T00:00:03Z',
      type: 'status',
      content: '',
      structuredData: {
        phase: 'artifact_produced',
        messageType: 'artifact_produced',
        outputArtifacts: [{ type: 'review_findings', name: 'findings', version: 1, checksum: 'x' }],
      },
    });

    const doneLine = makeLine({
      roleId: 'review_findings_writer',
      dispatchId: 'dispatch-2',
      stateId: 'WRAP_UP',
      timestamp: '2026-01-01T00:00:04Z',
      type: 'status',
      content: 'Done',
      protocolMessage: {
        messageType: 'done',
        payload: { summary: 'Findings produced' },
      },
    });

    const allLines = [
      taskPromptLine,
      agentOutputLine,
      permissionLine,
      artifactProducedLine,
      doneLine,
    ];
    const groups = makeGroups(allLines, 'dispatch-2', 'review_findings_writer');

    renderWithRouter(<AgentOutputPanel groups={groups} status="connected" isRunActive={false} />);

    const triggers = screen.getAllByRole('button', { name: 'View artifacts' });
    expect(triggers.length).toBeGreaterThanOrEqual(1);

    await user.click(triggers[0]);

    expect(screen.getByText('Review Findings v1')).toBeInTheDocument();
    expect(screen.queryByText('Not produced yet')).not.toBeInTheDocument();
  });
});

describe('PromptModal', () => {
  it('renders prompt content', () => {
    renderWithRouter(<PromptModal prompt="Test prompt content" onClose={vi.fn()} />);
    expect(screen.getByText('Prompt')).toBeInTheDocument();
  });

  it('has dialog role and aria-modal on backdrop', () => {
    renderWithRouter(<PromptModal prompt="test" onClose={vi.fn()} />);
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(backdrop).toHaveAttribute('role', 'dialog');
    expect(backdrop).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when clicking directly on the backdrop', () => {
    const onClose = vi.fn();
    renderWithRouter(<PromptModal prompt="test" onClose={onClose} />);
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose for other keys on backdrop', () => {
    const onClose = vi.fn();
    renderWithRouter(<PromptModal prompt="test" onClose={onClose} />);
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.keyDown(backdrop, { key: 'Tab' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithRouter(<PromptModal prompt="test" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
