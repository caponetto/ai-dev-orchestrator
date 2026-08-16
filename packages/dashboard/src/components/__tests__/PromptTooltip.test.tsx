// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PromptDialog, PromptTrigger } from '../PromptTooltip';

describe('PromptTrigger', () => {
  it('renders a button with "Show prompt" aria-label', () => {
    render(<PromptTrigger onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Show prompt' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<PromptTrigger onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show prompt' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('stops event propagation on click', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <PromptTrigger onClick={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show prompt' }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});

describe('PromptDialog', () => {
  it('does not render dialog when closed', () => {
    render(<PromptDialog prompt="Test" open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with prompt content when open', () => {
    render(<PromptDialog prompt="My prompt content" open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('My prompt content')).toBeInTheDocument();
  });

  it('displays the "Prompt" heading', () => {
    render(<PromptDialog prompt="Some prompt" open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Prompt')).toBeInTheDocument();
  });

  it('renders prompt text with preserved whitespace', () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    render(<PromptDialog prompt={multiline} open={true} onOpenChange={vi.fn()} />);
    expect(
      screen.getByText(
        (_content, element) => element?.tagName === 'P' && element.textContent === multiline,
      ),
    ).toBeInTheDocument();
  });

  it('shows a copy button', () => {
    render(<PromptDialog prompt="Copy me" open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when close button is clicked', () => {
    const onOpenChange = vi.fn();
    render(<PromptDialog prompt="Close me" open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('dialog is rendered outside table row in the architecture', () => {
    const rowClick = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <div>
        <div onClick={rowClick} role="row">
          <PromptTrigger onClick={vi.fn()} />
        </div>
        <PromptDialog prompt="Test" open={true} onOpenChange={onOpenChange} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(rowClick).not.toHaveBeenCalled();
  });
});
