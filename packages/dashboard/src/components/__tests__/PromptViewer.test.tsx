import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import { buildDispatchPromptMap, PromptButton, PromptModal } from '../output';

function makeStreamEvent(
  overrides: Partial<DashboardAgentStreamEvent> & { structuredData?: Record<string, unknown> },
): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'STATE',
    roleId: 'planner',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'status',
    content: '',
    ...overrides,
  };
}

describe('buildDispatchPromptMap', () => {
  it('indexes rolePrompt by dispatchId from task_prompt events', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        roleId: 'planner',
        structuredData: { messageType: 'task_prompt', rolePrompt: '## Plan\nBuild the thing' },
        protocolMessage: {
          messageType: 'task_prompt',
          payload: { rolePrompt: '## Plan\nBuild the thing' },
        },
      }),
      makeStreamEvent({
        dispatchId: 'dispatch-2',
        roleId: 'reviewer',
        structuredData: { messageType: 'task_prompt', rolePrompt: '## Review\nCheck the plan' },
        protocolMessage: {
          messageType: 'task_prompt',
          payload: { rolePrompt: '## Review\nCheck the plan' },
        },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(2);
    expect(map.get('dispatch-1')).toBe('## Plan\nBuild the thing');
    expect(map.get('dispatch-2')).toBe('## Review\nCheck the plan');
  });

  it('ignores events without rolePrompt', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: { messageType: 'task_prompt', description: 'no prompt here' },
        protocolMessage: { messageType: 'task_prompt', payload: { description: 'no prompt here' } },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(0);
  });

  it('ignores non-task_prompt events', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: { phase: 'usage_update', rolePrompt: 'should be ignored' },
        protocolMessage: { messageType: 'log', payload: { rolePrompt: 'should be ignored' } },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(0);
  });

  it('overwrites prompt when same dispatchId appears twice (rework)', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: { messageType: 'task_prompt', rolePrompt: 'v1 prompt' },
        protocolMessage: { messageType: 'task_prompt', payload: { rolePrompt: 'v1 prompt' } },
      }),
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: { messageType: 'task_prompt', rolePrompt: 'v2 prompt' },
        protocolMessage: { messageType: 'task_prompt', payload: { rolePrompt: 'v2 prompt' } },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(1);
    expect(map.get('dispatch-1')).toBe('v2 prompt');
  });

  it('prefers cli_prompt over task_prompt for the same dispatchId', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: { messageType: 'task_prompt', rolePrompt: 'role-only prompt' },
        protocolMessage: {
          messageType: 'task_prompt',
          payload: { rolePrompt: 'role-only prompt' },
        },
      }),
      makeStreamEvent({
        dispatchId: 'dispatch-1',
        structuredData: {
          messageType: 'cli_prompt',
          cliPrompt: 'full CLI prompt with verbosity rules',
        },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(1);
    expect(map.get('dispatch-1')).toBe('full CLI prompt with verbosity rules');
  });

  it('ignores events without dispatchId', () => {
    const lines: DashboardAgentStreamEvent[] = [
      makeStreamEvent({
        dispatchId: '',
        structuredData: { messageType: 'task_prompt', rolePrompt: 'orphaned prompt' },
        protocolMessage: { messageType: 'task_prompt', payload: { rolePrompt: 'orphaned prompt' } },
      }),
    ];

    const map = buildDispatchPromptMap(lines);

    expect(map.size).toBe(0);
  });
});

describe('PromptModal', () => {
  it('renders the title and markdown content', () => {
    render(<PromptModal prompt={'## Hello\n\nThis is **bold**.'} onClose={() => {}} />);

    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('humanizes embedded JSON into readable markdown', () => {
    const prompt = '## Input\n\n{"title":"My Plan","summary":"Build the thing"}';
    render(<PromptModal prompt={prompt} onClose={() => {}} />);

    expect(screen.getByText('My Plan')).toBeInTheDocument();
    expect(screen.getByText(/Build the thing/)).toBeInTheDocument();
  });

  it('humanizes JSON arrays embedded in template sections', () => {
    const json = JSON.stringify([
      { title: 'Create AGENTS.md', sourceMetadata: { fetchedAt: '2026-07-16' } },
    ]);
    const prompt = `## Specification\n\n${json}\n\n## Plan Quality Criteria`;
    render(<PromptModal prompt={prompt} onClose={() => {}} />);

    expect(screen.getByText('Create AGENTS.md')).toBeInTheDocument();
    expect(screen.getByText('Plan Quality Criteria')).toBeInTheDocument();
  });

  it('humanizes JSON preceded by prose on the prior line within a paragraph', () => {
    const json = JSON.stringify({ id: 'spec-001', title: 'My Spec', version: 1 });
    const prompt = `## Previous Canonical Specification\n\nTreat it as the baseline:\n${json}\n\n## Next Section`;
    render(<PromptModal prompt={prompt} onClose={() => {}} />);

    expect(screen.getByText('My Spec')).toBeInTheDocument();
    expect(screen.getByText(/baseline/)).toBeInTheDocument();
    expect(screen.getByText('Next Section')).toBeInTheDocument();
  });

  it('humanizes HTML-escaped JSON from Handlebars double-brace interpolation', () => {
    const prompt =
      '## Plan\n\n' +
      '{&quot;version&quot;:1,&quot;title&quot;:&quot;My Plan&quot;,&quot;summary&quot;:&quot;Build it&quot;}' +
      '\n\n## Quality Criteria';
    render(<PromptModal prompt={prompt} onClose={() => {}} />);

    expect(screen.getByText('My Plan')).toBeInTheDocument();
    expect(screen.getByText(/Build it/)).toBeInTheDocument();
    expect(screen.getByText('Quality Criteria')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    let closed = false;
    render(
      <PromptModal
        prompt="content"
        onClose={() => {
          closed = true;
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Close'));

    expect(closed).toBe(true);
  });

  it('calls onClose when Escape is pressed', () => {
    let closed = false;
    render(
      <PromptModal
        prompt="content"
        onClose={() => {
          closed = true;
        }}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(closed).toBe(true);
  });

  it('calls onClose when clicking the backdrop', () => {
    let closed = false;
    const { container } = render(
      <PromptModal
        prompt="content"
        onClose={() => {
          closed = true;
        }}
      />,
    );

    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(closed).toBe(true);
  });
});

describe('PromptButton', () => {
  it('renders a Prompt button', () => {
    render(<PromptButton prompt="some prompt" />);

    expect(screen.getByRole('button', { name: 'View prompt' })).toBeInTheDocument();
  });

  it('opens the modal when clicked', () => {
    render(<PromptButton prompt={'## Instructions\n\nDo the thing.'} />);

    expect(screen.queryByText('Instructions')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View prompt' }));

    expect(screen.getByText('Instructions')).toBeInTheDocument();
  });

  it('closes the modal when close button is clicked', () => {
    render(<PromptButton prompt={'## Instructions\n\nContent here.'} />);

    fireEvent.click(screen.getByRole('button', { name: 'View prompt' }));
    expect(screen.getByText('Instructions')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });
});
