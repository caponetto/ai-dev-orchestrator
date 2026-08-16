// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { ErrorBoundary } from '../ErrorBoundary';

function ThrowingChild({ error }: { error: Error }): React.ReactNode {
  throw error;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    renderWithRouter(
      <ErrorBoundary>
        <div>child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithRouter(
      <ErrorBoundary>
        <ThrowingChild error={new Error('test failure')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('test failure')).toBeInTheDocument();
  });

  it('shows a reload button on error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithRouter(
      <ErrorBoundary>
        <ThrowingChild error={new Error('crash')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});
