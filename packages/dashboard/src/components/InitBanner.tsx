import { AlertTriangle, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';

export function InitBanner() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(() => {
    api
      .fetchServerInfo()
      .then((info) => {
        setVisible(info.initialized === false);
      })
      .catch(() => {
        // server unreachable — don't show banner
      });
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (!visible || dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-yellow-900/40 bg-yellow-950/30 px-4 py-2 text-sm text-yellow-200"
    >
      <AlertTriangle className="size-4 shrink-0 text-yellow-500" />
      <span>
        AI Dev Orchestrator is not initialized. Run{' '}
        <code className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-xs font-medium">ai init</code>{' '}
        to set up the workspace before starting runs.
      </span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
        }}
        className="ml-auto shrink-0 rounded p-0.5 text-yellow-400 transition-colors hover:text-yellow-200"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
