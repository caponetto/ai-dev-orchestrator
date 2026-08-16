import type { ArtifactContentView, ArtifactEntryView } from '@ai-orchestrator/schemas';
import { MEDIA_FILE_EXTENSIONS } from '@ai-orchestrator/schemas';
import { formatBytes } from '@ai-orchestrator/utils/formatters';
import 'highlight.js/styles/github-dark.min.css';
import { Check, Copy, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { api } from '../api/client';
import { useEscapeKey } from '../hooks/use-escape-key';
import { humanize } from '../lib/humanize';

import { renderArtifactAsMarkdown } from './artifact-renderers';
import { Switch } from './ui/switch';

function RawView({ content }: Readonly<{ content: string }>) {
  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-background p-4 font-mono text-xs text-foreground/80">
      {content}
    </pre>
  );
}

const VIDEO_EXTENSIONS = MEDIA_FILE_EXTENSIONS.filter((e) => ['.webm', '.mp4'].includes(e));
const VIDEO_EXT_PATTERN = new RegExp(
  `\\.(${VIDEO_EXTENSIONS.map((e) => e.slice(1)).join('|')})$`,
  'i',
);
const FILE_API_PATTERN = /^\/api\/runs\/[^/]+\/files\//;

function VideoLinkRenderer({ href, children }: Readonly<{ href?: string; children?: ReactNode }>) {
  if (href && FILE_API_PATTERN.test(href) && VIDEO_EXT_PATTERN.test(href)) {
    return (
      <span className="my-2 block">
        <video
          controls
          preload="metadata"
          className="max-h-[400px] w-full rounded border border-border"
          src={href}
        >
          <track kind="captions" />
        </video>
        <span className="mt-1 block text-xs text-muted-foreground">{children}</span>
      </span>
    );
  }
  return <a href={href}>{children}</a>;
}

function ContentRenderer({
  content,
  contentType,
  artifactType,
  runId,
  raw,
}: Readonly<{
  content: string;
  contentType: ArtifactContentView['contentType'];
  artifactType?: string;
  runId?: string;
  raw: boolean;
}>) {
  const markdown = useMemo(
    () => (contentType === 'json' ? renderArtifactAsMarkdown(content, artifactType, runId) : null),
    [content, contentType, artifactType, runId],
  );

  if (raw) {
    const rawSource = contentType === 'json' ? (markdown ?? content) : content;
    return <RawView content={rawSource} />;
  }

  if (contentType === 'json') {
    return (
      <div className="prose prose-invert prose-sm min-h-0 max-w-none flex-1 overflow-auto rounded bg-background p-4">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{ a: VideoLinkRenderer }}
        >
          {markdown}
        </Markdown>
      </div>
    );
  }

  if (contentType === 'diff') {
    return (
      <pre className="min-h-0 flex-1 overflow-auto rounded bg-background p-4 text-xs">
        {content.split('\n').map((line, i) => {
          let color = 'text-muted-foreground';
          if (line.startsWith('+')) {
            color = 'text-green-400';
          } else if (line.startsWith('-')) {
            color = 'text-red-400';
          } else if (line.startsWith('@@')) {
            color = 'text-cyan-400';
          }
          return (
            <div key={i} className={color}>
              {line}
            </div>
          );
        })}
      </pre>
    );
  }

  if (contentType === 'markdown') {
    return (
      <div className="prose prose-invert prose-sm min-h-0 max-w-none flex-1 overflow-auto rounded bg-background p-4">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </Markdown>
      </div>
    );
  }

  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-background p-4 text-xs text-foreground/80">
      {content}
    </pre>
  );
}

export function ArtifactViewer({
  runId,
  artifact,
  onClose,
}: {
  runId: string;
  artifact: ArtifactEntryView;
  onClose: () => void;
}) {
  const [data, setData] = useState<ArtifactContentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = dialog.querySelectorAll<HTMLElement>(focusableSelector);
    const firstFocusable = focusableElements[0] as HTMLElement | undefined;
    const lastFocusable = focusableElements[focusableElements.length - 1] as
      HTMLElement | undefined;

    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') {
        return;
      }
      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);

    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const rawContent = useMemo(() => {
    if (!data) {
      return '';
    }
    if (data.contentType === 'json') {
      return renderArtifactAsMarkdown(data.content, artifact.type, runId);
    }
    return data.content;
  }, [data, artifact.type, runId]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(rawContent).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  }, [rawContent]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .fetchArtifactContent(runId, artifact.type, artifact.name, artifact.version)
      .then(setData)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId, artifact.type, artifact.name, artifact.version]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-viewer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="artifact-viewer"
    >
      <div className="flex h-[75vh] w-[75vw] flex-col rounded-lg bg-popover shadow-2xl ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 id="artifact-viewer-title" className="text-base font-semibold text-foreground">
              {humanize(artifact.type)} &middot; {humanize(artifact.producedBy)} &middot;{' '}
              {formatBytes(artifact.sizeBytes)} &middot; v{artifact.version}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="cursor-pointer p-2 text-muted-foreground hover:text-foreground"
              aria-label="Copy content"
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            </button>
            <div className="flex select-none items-center gap-2">
              <span className="text-xs text-muted-foreground" id="raw-toggle-label">
                Raw
              </span>
              <Switch
                size="sm"
                checked={raw}
                onCheckedChange={setRaw}
                aria-labelledby="raw-toggle-label"
              />
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer p-2 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data && (
            <ContentRenderer
              content={data.content}
              contentType={data.contentType}
              artifactType={artifact.type}
              runId={runId}
              raw={raw}
            />
          )}
        </div>
      </div>
    </div>
  );
}
