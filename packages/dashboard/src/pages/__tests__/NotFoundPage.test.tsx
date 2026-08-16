// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { NotFoundPage } from '../NotFoundPage';

describe('NotFoundPage', () => {
  it('renders 404 heading', () => {
    renderWithRouter(<NotFoundPage />);
    expect(screen.getByText('404')).toBeTruthy();
  });

  it('renders page not found message', () => {
    renderWithRouter(<NotFoundPage />);
    expect(screen.getByText('Page not found')).toBeTruthy();
  });

  it('renders description text', () => {
    renderWithRouter(<NotFoundPage />);
    expect(screen.getByText(/does not exist or has been moved/)).toBeTruthy();
  });

  it('renders a link to the home page', () => {
    renderWithRouter(<NotFoundPage />);
    const link = screen.getByText('Go Home');
    expect(link).toBeTruthy();
    expect(link.closest('a')?.getAttribute('href')).toBe('/');
  });
});
