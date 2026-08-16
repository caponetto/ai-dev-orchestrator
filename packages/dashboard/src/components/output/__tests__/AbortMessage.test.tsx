// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AbortMessage } from '../AbortMessage';

describe('AbortMessage', () => {
  it('renders "Aborted the run" for the default aborted variant', () => {
    render(<AbortMessage reason="User cancelled" />);
    expect(screen.getByText('Aborted the run')).toBeInTheDocument();
  });

  it('renders "Human" label for the aborted variant', () => {
    render(<AbortMessage reason="User cancelled" />);
    expect(screen.getByText('Human')).toBeInTheDocument();
  });

  it('renders "Run was interrupted" for the interrupted variant', () => {
    render(<AbortMessage reason="Timeout" variant="interrupted" />);
    expect(screen.getByText('Run was interrupted')).toBeInTheDocument();
  });

  it('renders "AI Dev Orchestrator" label for the interrupted variant', () => {
    render(<AbortMessage reason="Timeout" variant="interrupted" />);
    expect(screen.getByText('AI Dev Orchestrator')).toBeInTheDocument();
  });

  it('renders "Run aborted" for the failed variant', () => {
    render(<AbortMessage reason="Script failed" variant="failed" />);
    expect(screen.getByText('Run aborted')).toBeInTheDocument();
  });

  it('renders "AI Dev Orchestrator" label for the failed variant', () => {
    render(<AbortMessage reason="Script failed" variant="failed" />);
    expect(screen.getByText('AI Dev Orchestrator')).toBeInTheDocument();
  });

  it('hides details by default', () => {
    render(<AbortMessage reason="Secret reason" />);
    expect(screen.queryByText('Secret reason')).not.toBeInTheDocument();
    expect(screen.getByText('▶ Show details')).toBeInTheDocument();
  });

  it('shows details when the toggle button is clicked', () => {
    render(<AbortMessage reason="Detailed reason" />);
    fireEvent.click(screen.getByText('▶ Show details'));
    expect(screen.getByText('Detailed reason')).toBeInTheDocument();
    expect(screen.getByText('▼ Hide details')).toBeInTheDocument();
  });

  it('hides details again when toggled a second time', () => {
    render(<AbortMessage reason="Toggle me" />);
    fireEvent.click(screen.getByText('▶ Show details'));
    expect(screen.getByText('Toggle me')).toBeInTheDocument();
    fireEvent.click(screen.getByText('▼ Hide details'));
    expect(screen.queryByText('Toggle me')).not.toBeInTheDocument();
  });

  it('renders timestamp when provided', () => {
    render(<AbortMessage reason="reason" timestamp="2025-01-15T10:30:00Z" />);
    // Timestamp component renders time in locale format; just verify it's present
    const timestampEl = document.querySelector('[data-timestamp]');
    expect(timestampEl).toBeInTheDocument();
  });

  it('does not render timestamp when not provided', () => {
    render(<AbortMessage reason="no time" />);
    const timestampEl = document.querySelector('[data-timestamp]');
    expect(timestampEl).not.toBeInTheDocument();
  });
});
