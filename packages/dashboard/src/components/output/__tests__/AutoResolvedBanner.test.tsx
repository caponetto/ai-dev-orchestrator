// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AutoResolvedBanner } from '../AutoResolvedBanner';

const baseProps = {
  icon: '✓',
  color: 'text-green-400',
  label: 'Write File',
  resolved: 'auto-granted',
  reason: 'policy_match',
  action: 'file_write',
  resource: '/src/index.ts',
};

function clickToggle() {
  fireEvent.click(screen.getByRole('button'));
}

describe('AutoResolvedBanner', () => {
  it('renders the label and resolved status', () => {
    render(<AutoResolvedBanner {...baseProps} />);
    expect(screen.getByText(/Write File/)).toBeInTheDocument();
    expect(screen.getByText(/auto-granted/)).toBeInTheDocument();
  });

  it('renders the icon', () => {
    render(<AutoResolvedBanner {...baseProps} />);
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows role name when roleId is provided', () => {
    render(<AutoResolvedBanner {...baseProps} roleId="code_reviewer" />);
    expect(screen.getByText(/Code Reviewer/)).toBeInTheDocument();
  });

  it('hides details by default', () => {
    render(<AutoResolvedBanner {...baseProps} />);
    expect(screen.queryByText('/src/index.ts')).not.toBeInTheDocument();
  });

  it('shows details when the toggle is clicked', () => {
    render(<AutoResolvedBanner {...baseProps} />);
    clickToggle();
    expect(screen.getByText('/src/index.ts')).toBeInTheDocument();
  });

  it('hides details when toggled again', () => {
    render(<AutoResolvedBanner {...baseProps} />);
    clickToggle();
    expect(screen.getByText('/src/index.ts')).toBeInTheDocument();
    clickToggle();
    expect(screen.queryByText('/src/index.ts')).not.toBeInTheDocument();
  });

  it('shows the command for shell_execute actions', () => {
    render(
      <AutoResolvedBanner
        {...baseProps}
        action="shell_execute"
        toolInput={{ command: 'npm test' }}
      />,
    );
    clickToggle();
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });

  it('shows rawDetail for custom actions', () => {
    render(<AutoResolvedBanner {...baseProps} action="custom" rawDetail="Custom tool detail" />);
    clickToggle();
    expect(screen.getByText('Custom tool detail')).toBeInTheDocument();
  });

  it('shows file_path from toolInput for file actions', () => {
    render(
      <AutoResolvedBanner
        {...baseProps}
        action="file_write"
        toolInput={{ file_path: '/app/main.ts' }}
      />,
    );
    clickToggle();
    expect(screen.getByText('/app/main.ts')).toBeInTheDocument();
  });

  it('does not show the chevron when there is no detail', () => {
    render(
      <AutoResolvedBanner
        {...baseProps}
        action="custom"
        resource=""
        rawDetail={undefined}
        toolInput={undefined}
      />,
    );
    expect(screen.queryByText('›')).not.toBeInTheDocument();
  });

  it('shows reason text when expanded and not previously_approved', () => {
    render(<AutoResolvedBanner {...baseProps} reason="policy_match" />);
    clickToggle();
    expect(screen.getByText('policy_match')).toBeInTheDocument();
  });

  describe('previously_approved reason', () => {
    it('shows "previously approved" label', () => {
      render(
        <AutoResolvedBanner
          {...baseProps}
          reason="previously_approved:abc"
          resolved="auto-granted"
        />,
      );
      expect(screen.getByText(/previously approved/)).toBeInTheDocument();
    });

    it('uses the recycling icon for previously approved', () => {
      render(<AutoResolvedBanner {...baseProps} reason="previously_approved:abc" />);
      expect(screen.getByText('↻')).toBeInTheDocument();
    });

    it('does not show reason text in expanded details', () => {
      render(<AutoResolvedBanner {...baseProps} reason="previously_approved:abc" />);
      clickToggle();
      const italicElements = document.querySelectorAll('.italic');
      expect(italicElements).toHaveLength(0);
    });
  });
});
