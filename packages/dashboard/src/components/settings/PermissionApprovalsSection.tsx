import type { PermissionApprovalEntry } from '@ai-dev-orchestrator/schemas';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api/client';

import { SectionCard } from './FormControls';

const ACTION_LABELS: Record<string, string> = {
  file_read: 'Read File',
  file_write: 'Write File',
  file_delete: 'Delete File',
  shell_execute: 'Run Command',
  network_request: 'Network',
  git_operation: 'Git',
  custom: 'Custom',
};

export function PermissionApprovalsSection() {
  const [approvals, setApprovals] = useState<PermissionApprovalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const data = await api.fetchPermissionApprovals();
      setApprovals(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApprovals();
  }, [fetchApprovals]);

  const handleRemove = async (id: string) => {
    try {
      await api.deletePermissionApproval(id);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove approval');
    }
  };

  const handleClearAll = async () => {
    try {
      await api.clearPermissionApprovals();
      setApprovals([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear approvals');
    }
  };

  return (
    <SectionCard
      title="Permission Memory"
      tooltip="Commands and actions previously approved by you. Future matching requests are auto-granted without prompting."
    >
      {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!loading && approvals.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No stored approvals yet. Approvals are saved when you grant permissions during a run.
        </p>
      )}
      {!loading && approvals.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {String(approvals.length)} stored approval{approvals.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => void handleClearAll()}
              className="rounded border border-red-900/50 px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-950/30"
            >
              Clear All
            </button>
          </div>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {approvals.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-card">
                    <td className="px-3 py-2 text-foreground/80">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </td>
                    <td className="px-3 py-2">
                      <span className="break-all font-mono text-muted-foreground">
                        {entry.resource.length > 60
                          ? `...${entry.resource.slice(-57)}`
                          : entry.resource}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {entry.createdByRole ? entry.createdByRole.replace(/_/g, ' ') : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void handleRemove(entry.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
