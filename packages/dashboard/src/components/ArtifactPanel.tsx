import type { ArtifactEntryView, ArtifactInventoryView } from '@ai-orchestrator/schemas';
import { useMemo, useState } from 'react';
import { format } from 'timeago.js';

import { humanize } from '../lib/humanize';
import { cn } from '../lib/utils';

import { ArtifactViewer } from './ArtifactViewer';

export const verdictColorMap: Record<string, string> = {
  approved: 'text-green-400 hover:text-green-300',
  conditionally_approved: 'text-yellow-400 hover:text-yellow-300',
  rejected: 'text-red-400 hover:text-red-300',
};
export const DEFAULT_VERDICT_COLOR = 'text-blue-400 hover:text-blue-300';

interface ArtifactGroup {
  type: string;
  name: string;
  producedBy: string;
  versions: ArtifactEntryView[];
}

function groupArtifacts(artifacts: readonly ArtifactEntryView[]): ArtifactGroup[] {
  const map = new Map<string, ArtifactGroup>();
  for (const a of artifacts) {
    const key = a.type;
    let group = map.get(key);
    if (!group) {
      group = { type: a.type, name: a.name, producedBy: a.producedBy, versions: [] };
      map.set(key, group);
    }
    if (!group.producedBy && a.producedBy) {
      group.producedBy = a.producedBy;
    }
    group.versions.push(a);
  }
  for (const group of map.values()) {
    const deduped = new Map<number, ArtifactEntryView>();
    for (const v of group.versions) {
      deduped.set(v.version, v);
    }
    group.versions = [...deduped.values()].sort((a, b) => a.version - b.version);
  }
  return [...map.values()].sort((a, b) => {
    const aDate = a.versions[0]?.createdAt ?? '';
    const bDate = b.versions[0]?.createdAt ?? '';
    return aDate.localeCompare(bDate);
  });
}

export function ArtifactPanel({
  data,
  runId,
}: Readonly<{ data: ArtifactInventoryView; runId?: string }>) {
  const [selected, setSelected] = useState<ArtifactEntryView | null>(null);
  const groups = useMemo(() => groupArtifacts(data.artifacts), [data.artifacts]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="overflow-hidden rounded border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-background text-left text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Created By</th>
              <th className="px-3 py-1.5 font-medium">Last Updated</th>
              <th className="w-1/2 px-3 py-1.5 font-medium">Versions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {groups.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-center text-muted-foreground">
                  No artifacts yet
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={`${g.type}-${g.name}`} className="transition-colors hover:bg-muted/50">
                <td className="px-3 py-1.5 font-medium text-foreground">{humanize(g.type)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {g.producedBy ? humanize(g.producedBy) : '—'}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {g.versions.length > 0 ? format(g.versions.at(-1)?.createdAt ?? '') : '—'}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    {g.versions.map((v) => {
                      const color = verdictColorMap[v.verdict ?? ''] ?? DEFAULT_VERDICT_COLOR;
                      return (
                        <button
                          key={v.version}
                          aria-label={`View ${humanize(g.type)} version ${String(v.version)}`}
                          className={cn(
                            'cursor-pointer rounded px-2 py-1 text-2xs ring-1 ring-border hover:ring-white/[0.08]',
                            color,
                          )}
                          onClick={() => {
                            if (runId) {
                              setSelected(v);
                            }
                          }}
                        >
                          v{v.version}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && runId && (
        <ArtifactViewer
          runId={runId}
          artifact={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
