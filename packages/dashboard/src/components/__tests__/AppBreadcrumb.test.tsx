// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { AppBreadcrumb } from '../AppBreadcrumb';

describe('AppBreadcrumb', () => {
  it('renders "Runs" as the single crumb on the root /runs path', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/runs' });
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('renders "Health" for /health path', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/health' });
    expect(screen.getByText('Health')).toBeInTheDocument();
  });

  it('renders breadcrumb trail for /runs/new', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/runs/new' });
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('New Run')).toBeInTheDocument();
  });

  it('renders breadcrumb trail for a specific run', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/runs/abc-123' });
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('abc-123')).toBeInTheDocument();
  });

  it('links Runs crumb back to /runs on a detail page', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/runs/abc-123' });
    const runsLink = screen.getByText('Runs').closest('a');
    expect(runsLink).toHaveAttribute('href', '/runs');
  });

  it('renders the default breadcrumb for unmatched paths', () => {
    renderWithRouter(<AppBreadcrumb />, { route: '/' });
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });
});
