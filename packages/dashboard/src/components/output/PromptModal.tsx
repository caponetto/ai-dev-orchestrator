import { FileText, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { renderArtifactAsMarkdown } from '../artifact-renderers';

function unescapeHtml(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function tryRenderJson(text: string): string | null {
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const artifactType =
        typeof obj['__artifactType'] === 'string' ? obj['__artifactType'] : undefined;
      if (artifactType) {
        const { __artifactType: _, ...rest } = obj;
        return renderArtifactAsMarkdown(JSON.stringify(rest, null, 2), artifactType);
      }
      return renderArtifactAsMarkdown(trimmed);
    }
    if (Array.isArray(parsed)) {
      return renderArtifactAsMarkdown(trimmed);
    }
  } catch {
    // Not JSON
  }
  return null;
}

function humanizeEmbeddedJson(text: string): string {
  const unescaped = unescapeHtml(text);
  return unescaped
    .split(/\n\n/)
    .map((segment) => {
      const rendered = tryRenderJson(segment);
      if (rendered !== null) {
        return rendered;
      }

      const jsonStart = segment.search(/\n\s*[{[]/);
      if (jsonStart >= 0) {
        const prose = segment.slice(0, jsonStart);
        const jsonPart = segment.slice(jsonStart + 1);
        const jsonRendered = tryRenderJson(jsonPart);
        if (jsonRendered !== null) {
          return `${prose}\n\n${jsonRendered}`;
        }
      }

      return segment;
    })
    .join('\n\n');
}

export function PromptModal({
  prompt,
  onClose,
}: Readonly<{
  prompt: string;
  onClose: () => void;
}>) {
  const rendered = useMemo(() => humanizeEmbeddedJson(prompt), [prompt]);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

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

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex h-[75vh] w-[90vw] max-w-6xl flex-col rounded-lg bg-popover shadow-2xl ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 id="prompt-modal-title" className="text-sm font-semibold text-foreground">
            Prompt
          </h3>
          <button
            onClick={onClose}
            className="cursor-pointer p-2 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="prose prose-invert prose-sm min-h-0 flex-1 max-w-none overflow-auto p-4">
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {rendered}
          </Markdown>
        </div>
      </div>
    </div>
  );
}

export function PromptButton({ prompt }: Readonly<{ prompt: string }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
        title="View prompt"
        aria-label="View prompt"
      >
        <FileText className="size-3" />
      </button>
      {open && (
        <PromptModal
          prompt={prompt}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
