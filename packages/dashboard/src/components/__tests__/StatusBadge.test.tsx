// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders the status text', () => {
    renderWithRouter(<StatusBadge status="running" />);
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('shows a pulse indicator for running status', () => {
    const { container } = renderWithRouter(<StatusBadge status="running" />);
    expect(container.querySelector('.motion-safe\\:animate-ping')).toBeInTheDocument();
  });

  it('does not show pulse for completed status', () => {
    const { container } = renderWithRouter(<StatusBadge status="completed" />);
    expect(container.querySelector('.motion-safe\\:animate-ping')).not.toBeInTheDocument();
  });
});
