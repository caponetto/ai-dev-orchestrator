// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScriptOutputBlock } from '../ScriptOutputBlock';

describe('ScriptOutputBlock', () => {
  it('renders the script name as a clickable link', () => {
    render(<ScriptOutputBlock script="build.sh" status="running" />);
    expect(screen.getByRole('button', { name: 'build.sh' })).toBeInTheDocument();
  });

  it('renders "Script Runner" label', () => {
    render(<ScriptOutputBlock script="deploy.sh" status="success" />);
    expect(screen.getByText('Script Runner')).toBeInTheDocument();
  });

  it('renders "Script Runner @ State" when state is provided', () => {
    render(<ScriptOutputBlock script="deploy.sh" status="success" state="publish_findings" />);
    expect(screen.getByText('Script Runner')).toBeInTheDocument();
    expect(screen.getByText('@ Publish Findings')).toBeInTheDocument();
  });

  it('renders only "Script Runner" when no state is provided', () => {
    render(<ScriptOutputBlock script="deploy.sh" status="success" />);
    expect(screen.getByText('Script Runner')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('shows "Running..." for running scripts', () => {
    render(<ScriptOutputBlock script="test.sh" status="running" />);
    expect(screen.getByText('Running...')).toBeInTheDocument();
  });

  it('shows structured message on success', () => {
    render(
      <ScriptOutputBlock
        script="upload-findings-gist.ts"
        status="success"
        message="Findings published to: https://gist.github.com/caponetto/abc123"
      />,
    );
    expect(screen.getByText('Findings published to:', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://gist.github.com/caponetto/abc123' }),
    ).toBeInTheDocument();
  });

  it('shows "Done" on success without message when timestamp is present', () => {
    render(
      <ScriptOutputBlock script="test.sh" status="success" timestamp="2024-01-01T12:00:00Z" />,
    );
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows stderr on failure', () => {
    render(<ScriptOutputBlock script="test.sh" status="failed" stderr="Error: something failed" />);
    expect(screen.getByText('Error: something failed')).toBeInTheDocument();
  });

  it('does not show error block when status is failed but no stderr', () => {
    render(<ScriptOutputBlock script="test.sh" status="failed" />);
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
  });

  it('renders timestamp when provided', () => {
    render(
      <ScriptOutputBlock
        script="test.sh"
        status="success"
        message="All good"
        timestamp="2024-01-01T12:00:00Z"
      />,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('renders with bubble card style (border-l-2)', () => {
    const { container } = render(<ScriptOutputBlock script="test.sh" status="running" />);
    expect(container.querySelector('.border-l-2')).toBeInTheDocument();
  });

  it('calls onViewScript when script name is clicked', () => {
    const onViewScript = vi.fn();
    render(<ScriptOutputBlock script="deploy.sh" status="success" onViewScript={onViewScript} />);
    fireEvent.click(screen.getByRole('button', { name: 'deploy.sh' }));
    expect(onViewScript).toHaveBeenCalledWith('deploy.sh');
  });
});
