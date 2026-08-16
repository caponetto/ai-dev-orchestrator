import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);

export function ScriptViewer({
  scriptName,
  onClose,
}: Readonly<{
  scriptName: string;
  onClose: () => void;
}>) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .fetchScriptContent(scriptName)
      .then((data) => {
        setContent(data.content);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [scriptName]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
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

  const language = useMemo(() => {
    if (scriptName.endsWith('.ts') || scriptName.endsWith('.js')) {
      return 'typescript';
    }
    if (scriptName.endsWith('.sh') || scriptName.endsWith('.bash')) {
      return 'bash';
    }
    return undefined;
  }, [scriptName]);

  const highlighted = useMemo(() => {
    if (!content || !language) {
      return null;
    }
    return hljs.highlight(content, { language }).value;
  }, [content, language]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="script-viewer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="script-viewer"
    >
      <div className="flex h-[75vh] w-[75vw] flex-col rounded-lg bg-popover shadow-2xl ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 id="script-viewer-title" className="text-base font-semibold text-foreground">
            {scriptName}
          </h3>
          <button
            onClick={onClose}
            className="cursor-pointer p-2 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {content != null && highlighted && (
            <pre className="hljs flex-1 overflow-auto rounded bg-background p-4 font-mono text-xs leading-relaxed">
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          )}
          {content != null && !highlighted && (
            <pre className="flex-1 overflow-auto rounded bg-background p-4 font-mono text-xs leading-relaxed text-foreground/90">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
