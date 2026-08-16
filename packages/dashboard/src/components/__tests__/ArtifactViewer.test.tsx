// @vitest-environment jsdom
import type { ArtifactEntryView } from '@ai-orchestrator/schemas';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { renderWithRouter } from '../../test/render';
import { renderArtifactAsMarkdown } from '../artifact-renderers';
import { ArtifactViewer } from '../ArtifactViewer';

vi.mock('../../api/client', () => ({
  api: {
    fetchArtifactContent: vi.fn(),
  },
}));

vi.mock('../artifact-renderers', () => ({
  renderArtifactAsMarkdown: vi.fn(
    (content: string, _artifactType?: string, _runId?: string) => `rendered: ${content}`,
  ),
}));

const mockFetch = vi.mocked(api.fetchArtifactContent);
const mockRender = vi.mocked(renderArtifactAsMarkdown);

const mockArtifact: ArtifactEntryView = {
  ref: { type: 'plan', name: 'plan', version: 1, checksum: 'abc123' },
  type: 'plan',
  name: 'plan',
  version: 1,
  producedBy: 'planner',
  sizeBytes: 2048,
  createdAt: '2024-01-01T00:00:00Z',
  verdict: 'approved',
};

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockResolvedValue({
    content: '# Test Plan\nSome content',
    contentType: 'markdown',
    sizeBytes: 100,
  });
  mockRender.mockImplementation((content: string) => `rendered: ${content}`);
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ArtifactViewer', () => {
  it('renders the artifact viewer overlay', () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });

  it('displays artifact type and version', () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    expect(screen.getByText(/v1/)).toBeInTheDocument();
  });

  it('shows close button', () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders content after loading', async () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  // ---------- Error state ----------

  it('displays error message when fetch fails with Error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('displays stringified error when non-Error is thrown', async () => {
    mockFetch.mockRejectedValueOnce('string error');
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('string error')).toBeInTheDocument();
    });
  });

  // ---------- Close button ----------

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ---------- Backdrop click ----------

  it('calls onClose when clicking the backdrop', () => {
    const onClose = vi.fn();
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={onClose} />);

    const backdrop = screen.getByTestId('artifact-viewer');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the dialog content', () => {
    const onClose = vi.fn();
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={onClose} />);

    const heading = screen.getByText(/Plan/);
    fireEvent.click(heading);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ---------- Escape key ----------

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ---------- Content types ----------

  describe('markdown content type', () => {
    it('renders markdown content with headings', async () => {
      mockFetch.mockResolvedValueOnce({
        content: '# Hello\nworld',
        contentType: 'markdown',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('world')).toBeInTheDocument();
    });

    it('renders markdown content with paragraphs', async () => {
      mockFetch.mockResolvedValueOnce({
        content: '## Section\n\nSome paragraph.',
        contentType: 'markdown',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Section')).toBeInTheDocument();
      });
      expect(screen.getByText('Some paragraph.')).toBeInTheDocument();
    });
  });

  describe('json content type', () => {
    it('renders JSON content through renderArtifactAsMarkdown', async () => {
      mockFetch.mockResolvedValueOnce({
        content: '{"key":"value"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
      // The mock renderArtifactAsMarkdown returns `rendered: <content>`
      await waitFor(() => {
        expect(screen.getByText(/rendered:/)).toBeInTheDocument();
      });
      expect(mockRender).toHaveBeenCalledWith('{"key":"value"}', 'plan', 'run-1');
    });
  });

  describe('diff content type', () => {
    it('renders diff with colored lines', async () => {
      const diffContent = [
        '@@ -1,3 +1,3 @@',
        '-removed line',
        '+added line',
        ' unchanged line',
      ].join('\n');

      mockFetch.mockResolvedValueOnce({
        content: diffContent,
        contentType: 'diff',
        sizeBytes: 80,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const addedLine = screen.getByText('+added line');
      expect(addedLine).toHaveClass('text-green-400');

      const removedLine = screen.getByText('-removed line');
      expect(removedLine).toHaveClass('text-red-400');

      const hunkHeader = screen.getByText('@@ -1,3 +1,3 @@');
      expect(hunkHeader).toHaveClass('text-cyan-400');

      const unchangedLine = screen.getByText('unchanged line');
      expect(unchangedLine).toHaveClass('text-muted-foreground');
    });
  });

  describe('text (fallback) content type', () => {
    it('renders plain text in a pre element', async () => {
      mockFetch.mockResolvedValueOnce({
        content: 'plain text content here',
        contentType: 'text',
        sizeBytes: 30,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('plain text content here')).toBeInTheDocument();
      });
    });
  });

  // ---------- Raw toggle ----------

  describe('raw mode', () => {
    it('toggles raw mode on via switch for markdown content', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        content: '# Heading\nParagraph',
        contentType: 'markdown',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      // Toggle raw mode on
      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      // In raw mode for markdown, content is shown as raw text in a <pre>
      // The raw text preserves the original markdown source
      await waitFor(() => {
        const pre = document.querySelector('pre');
        expect(pre).toBeInTheDocument();
        expect(pre?.textContent).toContain('# Heading');
        expect(pre?.textContent).toContain('Paragraph');
      });
    });

    it('shows rendered markdown in raw mode for json content type', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        content: '{"key":"value"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      // Toggle raw mode on
      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      // In raw mode for JSON, it shows the renderArtifactAsMarkdown output as raw text in <pre>
      await waitFor(() => {
        const pre = document.querySelector('pre');
        expect(pre).toBeInTheDocument();
        expect(pre?.textContent).toContain('rendered:');
      });
    });

    it('shows original content in raw mode for text content type', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        content: 'plain text here',
        contentType: 'text',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      await waitFor(() => {
        const pre = document.querySelector('pre');
        expect(pre?.textContent).toContain('plain text here');
      });
    });

    it('shows original content in raw mode for diff content type', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        content: '+added\n-removed',
        contentType: 'diff',
        sizeBytes: 30,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      // In raw mode, diff content shown as raw text in <pre> without coloring
      await waitFor(() => {
        const pre = document.querySelector('pre');
        expect(pre?.textContent).toContain('+added');
        expect(pre?.textContent).toContain('-removed');
      });
    });

    it('falls back to raw content when renderArtifactAsMarkdown returns null for json', async () => {
      const user = userEvent.setup();
      // When renderArtifactAsMarkdown returns null, the ?? operator kicks in
      mockRender.mockReturnValue(null as unknown as string);

      mockFetch.mockResolvedValueOnce({
        content: '{"fallback":"content"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      // Toggle raw mode on
      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      // When markdown is null, rawSource falls back to content via ?? operator
      await waitFor(() => {
        const pre = document.querySelector('pre');
        expect(pre?.textContent).toContain('{"fallback":"content"}');
      });
    });
  });

  // ---------- Copy button ----------

  describe('copy button', () => {
    it('copies content to clipboard and shows confirmation', async () => {
      mockFetch.mockResolvedValueOnce({
        content: 'content to copy',
        contentType: 'text',
        sizeBytes: 30,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /copy/i });
      expect(copyButton).toHaveAttribute('title', 'Copy');

      await act(async () => {
        fireEvent.click(copyButton);
        await Promise.resolve();
      });

      expect(writeTextMock).toHaveBeenCalledWith('content to copy');
      await waitFor(() => {
        expect(copyButton).toHaveAttribute('title', 'Copied!');
      });
    });

    it('copies rendered markdown for json content type', async () => {
      mockFetch.mockResolvedValueOnce({
        content: '{"key":"val"}',
        contentType: 'json',
        sizeBytes: 30,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /copy/i });

      await act(async () => {
        fireEvent.click(copyButton);
        await Promise.resolve();
      });

      // rawContent for json goes through renderArtifactAsMarkdown
      expect(writeTextMock).toHaveBeenCalledWith('rendered: {"key":"val"}');
    });

    it('resets copied state after timeout', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValueOnce({
        content: 'some text',
        contentType: 'text',
        sizeBytes: 30,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await vi.waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /copy/i });

      await act(async () => {
        fireEvent.click(copyButton);
        // Let the clipboard promise resolve
        await Promise.resolve();
      });

      await vi.waitFor(() => {
        expect(copyButton).toHaveAttribute('title', 'Copied!');
      });

      // Advance timers past the 2000ms reset
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      await vi.waitFor(() => {
        expect(copyButton).toHaveAttribute('title', 'Copy');
      });

      vi.useRealTimers();
    });

    it('copies empty string when data has not loaded yet', () => {
      // Make the fetch never resolve to keep loading state
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      const copyButton = screen.getByRole('button', { name: /copy/i });
      fireEvent.click(copyButton);
      expect(writeTextMock).toHaveBeenCalledWith('');
    });
  });

  // ---------- VideoLinkRenderer ----------

  describe('VideoLinkRenderer (via markdown with json content)', () => {
    it('renders a video element for mp4 file API links', async () => {
      mockRender.mockReturnValue('[my video](/api/runs/run-1/files/output.mp4)');
      mockFetch.mockResolvedValueOnce({
        content: '{"video":"link"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      // The Markdown component uses VideoLinkRenderer for <a> tags
      // When href matches FILE_API_PATTERN and VIDEO_EXT_PATTERN, it renders a <video>
      await waitFor(() => {
        const video = document.querySelector('video');
        expect(video).toBeInTheDocument();
        expect(video).toHaveAttribute('src', '/api/runs/run-1/files/output.mp4');
      });
    });

    it('renders a video element for webm file API links', async () => {
      mockRender.mockReturnValue('[my video](/api/runs/run-1/files/test.webm)');
      mockFetch.mockResolvedValueOnce({
        content: '{"video":"link"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        const video = document.querySelector('video');
        expect(video).toBeInTheDocument();
        expect(video).toHaveAttribute('src', '/api/runs/run-1/files/test.webm');
      });
    });

    it('renders a normal link for non-video file API links', async () => {
      mockRender.mockReturnValue('[my file](/api/runs/run-1/files/readme.txt)');
      mockFetch.mockResolvedValueOnce({
        content: '{"file":"link"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'my file' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/api/runs/run-1/files/readme.txt');
      });
      expect(document.querySelector('video')).not.toBeInTheDocument();
    });

    it('renders a normal link for non-API URLs even with video extension', async () => {
      mockRender.mockReturnValue('[external](https://example.com/video.mp4)');
      mockFetch.mockResolvedValueOnce({
        content: '{"link":"external"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'external' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://example.com/video.mp4');
      });
      expect(document.querySelector('video')).not.toBeInTheDocument();
    });

    it('renders a normal link when href is undefined', async () => {
      // Regular markdown link that has no href - the component still renders <a>
      mockRender.mockReturnValue('[text only link]()');
      mockFetch.mockResolvedValueOnce({
        content: '{"no":"href"}',
        contentType: 'json',
        sizeBytes: 50,
      });
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });

      expect(document.querySelector('video')).not.toBeInTheDocument();
    });
  });

  // ---------- Header info ----------

  describe('header display', () => {
    it('shows humanized artifact type, producer, size, and version', () => {
      renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

      expect(screen.getByText(/Plan/)).toBeInTheDocument();
      expect(screen.getByText(/Planner/)).toBeInTheDocument();
      expect(screen.getByText(/v1/)).toBeInTheDocument();
      // formatBytes(2048) = '2.0 KB'
      expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    });
  });

  // ---------- API call arguments ----------

  it('calls fetchArtifactContent with correct arguments', () => {
    const customArtifact: ArtifactEntryView = {
      ref: { type: 'review_report', name: 'report', version: 3, checksum: 'def456' },
      type: 'review_report',
      name: 'report',
      version: 3,
      producedBy: 'reviewer',
      sizeBytes: 4096,
      createdAt: '2024-06-15T12:00:00Z',
      verdict: 'rejected',
    };

    renderWithRouter(<ArtifactViewer runId="run-42" artifact={customArtifact} onClose={vi.fn()} />);

    expect(mockFetch).toHaveBeenCalledWith('run-42', 'review_report', 'report', 3);
  });

  // ---------- Raw toggle label ----------

  it('shows Raw label next to switch', () => {
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);
    expect(screen.getByText('Raw')).toBeInTheDocument();
  });

  // ---------- Copy button shows correct icon ----------

  it('shows copy icon initially and check icon after copy', async () => {
    mockFetch.mockResolvedValueOnce({
      content: 'test',
      contentType: 'text',
      sizeBytes: 10,
    });
    renderWithRouter(<ArtifactViewer runId="run-1" artifact={mockArtifact} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    const copyButton = screen.getByRole('button', { name: /copy/i });

    // Initially shows copy icon (no green check)
    expect(copyButton.querySelector('.text-green-400')).toBeNull();

    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    // After copy, shows check icon in green
    await waitFor(() => {
      expect(copyButton.querySelector('.text-green-400')).toBeInTheDocument();
    });
  });
});
