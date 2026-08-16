// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { AlertCircle, Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={AlertCircle} title="No results" description="Nothing to show" />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<EmptyState icon={AlertCircle} title="Empty" description="Try a different query" />);
    expect(screen.getByText('Try a different query')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    const { container } = render(
      <EmptyState icon={Search} title="No results" description="Nothing found" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders an action when provided', () => {
    render(
      <EmptyState
        icon={AlertCircle}
        title="No items"
        description="Get started"
        action={<button type="button">Create one</button>}
      />,
    );
    expect(screen.getByText('Create one')).toBeInTheDocument();
  });

  it('does not render an action wrapper when action is omitted', () => {
    const { container } = render(
      <EmptyState icon={AlertCircle} title="No items" description="Nothing here" />,
    );
    const heading = screen.getByText('No items');
    expect(heading).toBeInTheDocument();
    // The action wrapper div (mt-5) should not be present
    const actionDivs = container.querySelectorAll('.mt-5');
    expect(actionDivs).toHaveLength(0);
  });

  it('applies a custom className', () => {
    const { container } = render(
      <EmptyState
        icon={AlertCircle}
        title="Custom"
        description="desc"
        className="my-custom-class"
      />,
    );
    expect(container.firstChild).toHaveClass('my-custom-class');
  });
});
