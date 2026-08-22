// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../../hooks/use-agent-stream';
import {
  LineContent,
  TaskPromptContent,
  Timestamp,
  lineContentRenderers,
  renderDefaultLine,
  renderDoneLine,
  renderErrorLine,
  renderLogLine,
  renderPermissionResponseLine,
  renderProgressLine,
  renderRawLine,
} from '../line-renderers';

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'state-1',
    roleId: 'implementer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-15T10:30:00.000Z',
    type: 'stdout',
    content: 'hello world',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

describe('Timestamp', () => {
  it('renders a time string from a valid ISO timestamp', () => {
    render(<Timestamp iso="2026-01-15T10:30:00.000Z" />);
    const el = document.querySelector('[data-timestamp]');
    expect(el).toBeInTheDocument();
    expect(el?.textContent).toBeTruthy();
  });

  it('still renders for an invalid ISO string when the environment does not throw', () => {
    // In jsdom, new Date("not-a-date").toLocaleTimeString() returns "Invalid Date"
    // rather than throwing, so formatTime returns a truthy string and Timestamp renders.
    const { container } = render(<Timestamp iso="not-a-date" />);
    const el = container.querySelector('[data-timestamp]');
    expect(el).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TaskPromptContent
// ---------------------------------------------------------------------------

describe('TaskPromptContent', () => {
  it('renders the description from protocolMessage', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: 'Implement the feature' },
      },
    });
    render(<TaskPromptContent line={line} />);
    expect(screen.getByText('Implement the feature')).toBeInTheDocument();
  });

  it('renders a timestamp', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: 'task' },
      },
    });
    render(<TaskPromptContent line={line} />);
    expect(document.querySelector('[data-timestamp]')).toBeInTheDocument();
  });

  it('returns null when protocolMessage is missing', () => {
    const line = makeLine({ protocolMessage: undefined });
    const { container } = render(<TaskPromptContent line={line} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderRawLine
// ---------------------------------------------------------------------------

describe('renderRawLine', () => {
  it('renders stdout content with default foreground color', () => {
    const line = makeLine({ type: 'stdout', content: 'build succeeded' });
    const { container } = render(renderRawLine(line));
    expect(screen.getByText('build succeeded')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-foreground/80');
  });

  it('renders stderr content with red color by default', () => {
    const line = makeLine({ type: 'stderr', content: 'fatal error occurred' });
    const { container } = render(renderRawLine(line));
    expect(screen.getByText('fatal error occurred')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-red-400');
  });

  it('renders stderr with orange color when content contains "warn"', () => {
    const line = makeLine({ type: 'stderr', content: 'Warning: deprecated API' });
    const { container } = render(renderRawLine(line));
    expect(container.firstChild).toHaveClass('text-orange-400');
  });

  it('renders stderr with orange color when content contains "not available"', () => {
    const line = makeLine({ type: 'stderr', content: 'Feature not available in this version' });
    const { container } = render(renderRawLine(line));
    expect(container.firstChild).toHaveClass('text-orange-400');
  });

  it('renders stderr with orange color when content contains "no stdin"', () => {
    const line = makeLine({ type: 'stderr', content: 'no stdin detected' });
    const { container } = render(renderRawLine(line));
    expect(container.firstChild).toHaveClass('text-orange-400');
  });

  it('renders a timestamp', () => {
    const line = makeLine({ content: 'text' });
    render(renderRawLine(line));
    expect(document.querySelector('[data-timestamp]')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderProgressLine
// ---------------------------------------------------------------------------

describe('renderProgressLine', () => {
  it('renders detail and percent when both are provided', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'progress',
        payload: { detail: 'Compiling', percent: 42 },
      },
    });
    render(renderProgressLine(line));
    expect(screen.getByText(/Compiling/)).toBeInTheDocument();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it('renders detail without percent when percent is absent', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'progress',
        payload: { detail: 'Loading modules' },
      },
    });
    render(renderProgressLine(line));
    expect(screen.getByText('Loading modules')).toBeInTheDocument();
  });

  it('omits percent when percent is not a number', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'progress',
        payload: { detail: 'Working', percent: 'high' },
      },
    });
    const { container } = render(renderProgressLine(line));
    expect(container.textContent).not.toContain('%');
  });

  it('falls back to renderDefaultLine when protocolMessage is missing', () => {
    const line = makeLine({ content: 'fallback content' });
    render(renderProgressLine(line));
    expect(screen.getByText('fallback content')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderLogLine
// ---------------------------------------------------------------------------

describe('renderLogLine', () => {
  it('renders info level message without icon', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { level: 'info', message: 'Server started' },
      },
    });
    const { container } = render(renderLogLine(line));
    expect(screen.getByText('Server started')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-foreground/80');
  });

  it('renders warn level message with warning icon', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { level: 'warn', message: 'Disk space low' },
      },
    });
    const { container } = render(renderLogLine(line));
    expect(container.textContent).toContain('⚠');
    expect(screen.getByText(/Disk space low/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-yellow-400');
  });

  it('renders error level message with error icon', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { level: 'error', message: 'Connection failed' },
      },
    });
    const { container } = render(renderLogLine(line));
    expect(container.textContent).toContain('✗');
    expect(screen.getByText(/Connection failed/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-red-400');
  });

  it('renders debug level message with muted style', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { level: 'debug', message: 'Verbose output' },
      },
    });
    const { container } = render(renderLogLine(line));
    expect(screen.getByText('Verbose output')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-muted-foreground/60');
  });

  it('defaults to info level when level is absent', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { message: 'No level given' },
      },
    });
    const { container } = render(renderLogLine(line));
    expect(screen.getByText('No level given')).toBeInTheDocument();
    // info level has no icon
    expect(container.firstChild).toHaveClass('text-foreground/80');
  });

  it('falls back to renderDefaultLine when protocolMessage is missing', () => {
    const line = makeLine({ content: 'raw fallback' });
    render(renderLogLine(line));
    expect(screen.getByText('raw fallback')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderPermissionResponseLine
// ---------------------------------------------------------------------------

describe('renderPermissionResponseLine', () => {
  it('renders approved text with emerald color when granted is true', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'permission_response',
        payload: { granted: true },
      },
    });
    const { container } = render(renderPermissionResponseLine(line));
    expect(container.textContent).toContain('✓ Approved');
    expect(container.firstChild).toHaveClass('text-emerald-400');
  });

  it('renders did-not-approve text with red color when granted is false', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'permission_response',
        payload: { granted: false },
      },
    });
    const { container } = render(renderPermissionResponseLine(line));
    expect(container.textContent).toContain('✗ Did not approve');
    expect(container.firstChild).toHaveClass('text-red-400');
  });

  it('renders did-not-approve when granted is not strictly true', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'permission_response',
        payload: { granted: 'yes' },
      },
    });
    const { container } = render(renderPermissionResponseLine(line));
    expect(container.textContent).toContain('✗ Did not approve');
  });

  it('includes rejection message when present', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'permission_response',
        payload: { granted: false, message: 'Re-read the ticket and act.' },
      },
    });
    const { container } = render(renderPermissionResponseLine(line));
    expect(container.textContent).toContain('✗ Did not approve: Re-read the ticket and act.');
  });

  it('falls back to renderDefaultLine when protocolMessage is missing', () => {
    const line = makeLine({ content: 'fallback perm' });
    render(renderPermissionResponseLine(line));
    expect(screen.getByText('fallback perm')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderDoneLine
// ---------------------------------------------------------------------------

describe('renderDoneLine', () => {
  it('renders summary with checkmark and emerald color', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'done',
        payload: { summary: 'All tasks completed' },
      },
    });
    const { container } = render(renderDoneLine(line));
    expect(container.textContent).toContain('✓');
    expect(screen.getByText(/All tasks completed/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-emerald-400');
  });

  it('renders default "Done" when summary is missing', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'done',
        payload: {},
      },
    });
    const { container } = render(renderDoneLine(line));
    expect(container.textContent).toContain('Done');
  });

  it('falls back to renderDefaultLine when protocolMessage is missing', () => {
    const line = makeLine({ content: 'fallback done' });
    render(renderDoneLine(line));
    expect(screen.getByText('fallback done')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderErrorLine
// ---------------------------------------------------------------------------

describe('renderErrorLine', () => {
  it('renders error code and message with red color', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'error',
        payload: { code: 'TIMEOUT', message: 'Request timed out' },
      },
    });
    const { container } = render(renderErrorLine(line));
    expect(container.textContent).toContain('✗');
    expect(container.textContent).toContain('[TIMEOUT]');
    expect(screen.getByText(/Request timed out/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-red-400');
  });

  it('uses default code "error" when code is missing', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'error',
        payload: { message: 'Something broke' },
      },
    });
    const { container } = render(renderErrorLine(line));
    expect(container.textContent).toContain('[error]');
    expect(screen.getByText(/Something broke/)).toBeInTheDocument();
  });

  it('falls back to renderDefaultLine when protocolMessage is missing', () => {
    const line = makeLine({ content: 'fallback error' });
    render(renderErrorLine(line));
    expect(screen.getByText('fallback error')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderDefaultLine
// ---------------------------------------------------------------------------

describe('renderDefaultLine', () => {
  it('renders content with default foreground color', () => {
    const line = makeLine({ content: 'just a line' });
    const { container } = render(renderDefaultLine(line));
    expect(screen.getByText('just a line')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-foreground/80');
  });

  it('renders a timestamp', () => {
    const line = makeLine({ content: 'with time' });
    render(renderDefaultLine(line));
    expect(document.querySelector('[data-timestamp]')).toBeInTheDocument();
  });

  it('linkifies URLs in content', () => {
    const line = makeLine({ content: 'Visit https://example.com for info' });
    render(renderDefaultLine(line));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

// ---------------------------------------------------------------------------
// lineContentRenderers
// ---------------------------------------------------------------------------

describe('lineContentRenderers', () => {
  it('has a renderer for "progress"', () => {
    expect(lineContentRenderers.progress).toBe(renderProgressLine);
  });

  it('has a renderer for "log"', () => {
    expect(lineContentRenderers.log).toBe(renderLogLine);
  });

  it('has a renderer for "permission_response"', () => {
    expect(lineContentRenderers.permission_response).toBe(renderPermissionResponseLine);
  });

  it('has a renderer for "done"', () => {
    expect(lineContentRenderers.done).toBe(renderDoneLine);
  });

  it('has a renderer for "error"', () => {
    expect(lineContentRenderers.error).toBe(renderErrorLine);
  });

  it('contains exactly the expected keys', () => {
    const keys = Object.keys(lineContentRenderers).sort();
    expect(keys).toEqual(['done', 'error', 'log', 'permission_response', 'progress']);
  });
});

// ---------------------------------------------------------------------------
// LineContent
// ---------------------------------------------------------------------------

describe('LineContent', () => {
  it('uses renderRawLine when protocolMessage is absent', () => {
    const line = makeLine({ type: 'stderr', content: 'raw stderr output' });
    render(<LineContent line={line} />);
    expect(screen.getByText('raw stderr output')).toBeInTheDocument();
  });

  it('dispatches to the progress renderer for messageType "progress"', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'progress',
        payload: { detail: 'Building', percent: 80 },
      },
    });
    render(<LineContent line={line} />);
    expect(screen.getByText(/Building/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('dispatches to the log renderer for messageType "log"', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'log',
        payload: { level: 'warn', message: 'Low memory' },
      },
    });
    const { container } = render(<LineContent line={line} />);
    expect(screen.getByText(/Low memory/)).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-yellow-400');
  });

  it('dispatches to the permission_response renderer', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'permission_response',
        payload: { granted: true },
      },
    });
    const { container } = render(<LineContent line={line} />);
    expect(container.textContent).toContain('✓ Approved');
  });

  it('dispatches to the done renderer for messageType "done"', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'done',
        payload: { summary: 'Finished' },
      },
    });
    render(<LineContent line={line} />);
    expect(screen.getByText(/Finished/)).toBeInTheDocument();
  });

  it('dispatches to the error renderer for messageType "error"', () => {
    const line = makeLine({
      protocolMessage: {
        messageType: 'error',
        payload: { code: 'ERR', message: 'Failure' },
      },
    });
    const { container } = render(<LineContent line={line} />);
    expect(container.textContent).toContain('[ERR]');
    expect(screen.getByText(/Failure/)).toBeInTheDocument();
  });

  it('falls back to renderDefaultLine for an unknown messageType', () => {
    const line = makeLine({
      content: 'unknown protocol content',
      protocolMessage: {
        messageType: 'artifact',
        payload: {},
      },
    });
    render(<LineContent line={line} />);
    expect(screen.getByText('unknown protocol content')).toBeInTheDocument();
  });

  it('falls back to renderDefaultLine for task_prompt messageType', () => {
    const line = makeLine({
      content: 'task prompt content',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: 'Do something' },
      },
    });
    render(<LineContent line={line} />);
    // task_prompt is not in lineContentRenderers, so it falls back to default
    expect(screen.getByText('task prompt content')).toBeInTheDocument();
  });
});
