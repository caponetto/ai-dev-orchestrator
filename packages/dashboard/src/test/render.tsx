import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { EventStreamProvider } from '../hooks/event-stream-context';

export function renderWithRouter(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>
        <EventStreamProvider>{children}</EventStreamProvider>
      </MemoryRouter>
    ),
    ...options,
  });
}
