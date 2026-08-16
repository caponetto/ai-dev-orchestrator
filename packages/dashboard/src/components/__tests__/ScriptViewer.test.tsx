// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../../test/render';
import { server } from '../../test/server';
import { ScriptViewer } from '../ScriptViewer';

describe('ScriptViewer', () => {
  it('renders script name in header', () => {
    server.use(
      http.get('/api/scripts/upload.ts/content', () =>
        HttpResponse.json({ content: 'console.log("hi");', contentType: 'code' }),
      ),
    );
    renderWithRouter(<ScriptViewer scriptName="upload.ts" onClose={() => {}} />);
    expect(screen.getByText('upload.ts')).toBeInTheDocument();
  });

  it('fetches and displays script content', async () => {
    server.use(
      http.get('/api/scripts/run.py/content', () =>
        HttpResponse.json({ content: 'print("hello")', contentType: 'text' }),
      ),
    );
    renderWithRouter(<ScriptViewer scriptName="run.py" onClose={() => {}} />);
    expect(await screen.findByText('print("hello")')).toBeInTheDocument();
  });

  it('shows error when fetch fails', async () => {
    server.use(
      http.get(
        '/api/scripts/missing.ts/content',
        () => new HttpResponse(null, { status: 404, statusText: 'Not Found' }),
      ),
    );
    renderWithRouter(<ScriptViewer scriptName="missing.ts" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/404/)).toBeInTheDocument();
    });
  });

  it('calls onClose when backdrop is clicked', async () => {
    server.use(
      http.get('/api/scripts/test.ts/content', () =>
        HttpResponse.json({ content: 'code', contentType: 'code' }),
      ),
    );
    let closed = false;
    renderWithRouter(
      <ScriptViewer
        scriptName="test.ts"
        onClose={() => {
          closed = true;
        }}
      />,
    );
    await screen.findByText('test.ts');
    fireEvent.click(screen.getByTestId('script-viewer'));
    expect(closed).toBe(true);
  });

  it('shows loading state initially', () => {
    server.use(
      http.get('/api/scripts/slow.ts/content', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({ content: 'code', contentType: 'code' });
      }),
    );
    renderWithRouter(<ScriptViewer scriptName="slow.ts" onClose={() => {}} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
