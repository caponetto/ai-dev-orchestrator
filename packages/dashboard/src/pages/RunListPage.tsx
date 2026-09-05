import type { RunSummaryView } from '@ai-dev-orchestrator/schemas';
import { formatDuration } from '@ai-dev-orchestrator/utils/formatters';
import { ChevronLeft, ChevronRight, Inbox, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format as timeago } from 'timeago.js';

import { cn } from '@/lib/utils';

import { api } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { PromptDialog, PromptTrigger } from '../components/PromptTooltip';
import { StatusBadge } from '../components/StatusBadge';
import { TokenDisplay } from '../components/TokenDisplay';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { useFetch } from '../hooks/use-fetch';
import { formatTokens } from '../lib/format';
import { shouldRefreshRuns } from '../lib/refresh-triggers';
import { showError, showSuccess } from '../lib/toast';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type SortKey =
  | 'runId'
  | 'context'
  | 'workflow'
  | 'status'
  | 'startedAt'
  | 'durationMs'
  | 'totalArtifacts'
  | 'tokens';
type SortDir = 'asc' | 'desc';

function formatRepoPath(repoRoot?: string): string {
  if (!repoRoot) {
    return '—';
  }
  const parts = repoRoot.replace(/\/$/, '').split('/');
  return parts.at(-1) ?? '';
}

function sortRuns(runs: RunSummaryView[], key: SortKey, dir: SortDir): RunSummaryView[] {
  const sorted = [...runs].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'runId':
        cmp = a.runId.localeCompare(b.runId);
        break;
      case 'context':
        cmp = (a.repoRoot ?? '').localeCompare(b.repoRoot ?? '');
        break;
      case 'workflow':
        cmp = a.workflow.localeCompare(b.workflow);
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'startedAt':
        cmp = a.startedAt.localeCompare(b.startedAt);
        break;
      case 'durationMs':
        cmp = a.durationMs - b.durationMs;
        break;
      case 'totalArtifacts':
        cmp = a.totalArtifacts - b.totalArtifacts;
        break;
      case 'tokens':
        cmp = a.totalInputTokens + a.totalOutputTokens - (b.totalInputTokens + b.totalOutputTokens);
        break;
      default: {
        const _exhaustive: never = key;
        throw new Error(`Unhandled sort key: ${String(_exhaustive)}`);
      }
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export function RunListPage() {
  const {
    data: runs,
    loading,
    error,
    refresh: refreshRuns,
  } = useFetch(api.fetchRuns, { pollMs: 5_000, sseFilter: shouldRefreshRuns });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('startedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [promptToShow, setPromptToShow] = useState<string | null>(null);
  const [contextTarget, setContextTarget] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchQuery = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const workflowFilter = searchParams.get('workflow') ?? 'all';
  const [inputValue, setInputValue] = useState(searchQuery);

  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '' || value === 'all') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const allRuns = runs ?? [];
  const workflows = useMemo(() => [...new Set(allRuns.map((r) => r.workflow))].sort(), [allRuns]);
  const statuses = useMemo(() => [...new Set(allRuns.map((r) => r.status))].sort(), [allRuns]);

  const filteredRuns = useMemo(() => {
    let result = allRuns;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.runId.toLowerCase().includes(q) ||
          r.workflow.toLowerCase().includes(q) ||
          (r.repoRoot ?? '').toLowerCase().includes(q),
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }

    if (workflowFilter !== 'all') {
      result = result.filter((r) => r.workflow === workflowFilter);
    }

    return result;
  }, [allRuns, searchQuery, statusFilter, workflowFilter]);

  const sortedRuns = useMemo(
    () => sortRuns(filteredRuns, sortKey, sortDir),
    [filteredRuns, sortKey, sortDir],
  );

  const PAGE_SIZE = 15;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(page, totalPages);
  const pagedRuns = sortedRuns.slice(
    (safeCurrentPage - 1) * PAGE_SIZE,
    safeCurrentPage * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, workflowFilter, sortKey, sortDir]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isInput) {
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      if (e.key === 'N' || e.key === 'n') {
        e.preventDefault();
        void Promise.resolve(navigate('/runs/new'));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);

  const hasActiveFilters = searchQuery !== '' || statusFilter !== 'all' || workflowFilter !== 'all';

  const clearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter('q', inputValue);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [inputValue, setFilter]);

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleDeleteConfirmed = async () => {
    const ids = [...selected];
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => api.deleteRun(id)));
      showSuccess(`Deleted ${ids.length === 1 ? '1 run' : `${String(ids.length)} runs`}`);
      setSelected(new Set());
      refreshRuns();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleContextDelete = () => {
    if (contextTarget) {
      setSelected(new Set([contextTarget]));
      setShowDeleteModal(true);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-8 w-24" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg border border-border p-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">Failed to load runs: {error}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Make sure the backend is running on port 9100
          </p>
        </div>
      </div>
    );
  }

  if (allRuns.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => {
              void Promise.resolve(navigate('/runs/new'));
            }}
          >
            <Plus className="size-4" />
            New Run
          </Button>
        </div>
        <EmptyState
          icon={Inbox}
          title="No runs yet"
          description="Start a new run to begin orchestrating your AI agents"
          action={
            <Button
              size="sm"
              onClick={() => {
                void Promise.resolve(navigate('/runs/new'));
              }}
            >
              <Plus className="size-4" />
              Create your first run
            </Button>
          }
        />
      </div>
    );
  }

  const deleteLabel = selected.size === 1 ? '1 run' : `${String(selected.size)} runs`;

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <h2 className="sr-only">Runs</h2>
      {allRuns.length > 0 &&
        (() => {
          const completedRuns = allRuns.filter((r) => r.durationMs > 0);
          const avgDurationMs =
            completedRuns.length > 0
              ? Math.round(
                  completedRuns.reduce((s, r) => s + r.durationMs, 0) / completedRuns.length,
                )
              : undefined;
          const latestStartedAt = allRuns.reduce(
            (latest, r) => (r.startedAt > latest ? r.startedAt : latest),
            allRuns[0].startedAt,
          );
          const stats = [
            {
              label: 'Active',
              value: String(
                allRuns.filter((r) => r.status === 'running' || r.status === 'waiting').length,
              ),
              color: 'border-l-blue-500',
            },
            {
              label: 'Completed',
              value: String(allRuns.filter((r) => r.status === 'completed').length),
              color: 'border-l-emerald-500',
            },
            {
              label: 'Failed',
              value: String(
                allRuns.filter((r) => r.status === 'failed' || r.status === 'aborted').length,
              ),
              color: 'border-l-red-500',
            },
            ...(avgDurationMs != null
              ? [
                  {
                    label: 'Avg Duration',
                    value: formatDuration(avgDurationMs),
                    color: 'border-l-muted-foreground/50',
                  },
                ]
              : []),
            {
              label: 'Latest Run',
              value: timeago(latestStartedAt),
              color: 'border-l-muted-foreground/50',
            },
          ];
          const totalIn = allRuns.reduce((s, r) => s + r.totalInputTokens, 0);
          const totalOut = allRuns.reduce((s, r) => s + r.totalOutputTokens, 0);
          return (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {stats.map((stat, i) => (
                <div
                  key={stat.label}
                  className={cn(
                    'rounded-lg border-l-2 bg-card/80 px-4 py-3 ring-1 ring-white/[0.04] motion-safe:animate-fade-in-up',
                    stat.color,
                  )}
                  style={{ animationDelay: `${String(i * 60)}ms` }}
                >
                  <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                    {stat.value}
                  </p>
                </div>
              ))}
              <div
                className="rounded-lg border-l-2 border-l-primary bg-card/80 px-4 py-3 ring-1 ring-white/[0.04] motion-safe:animate-fade-in-up"
                style={{ animationDelay: `${String(stats.length * 60)}ms` }}
              >
                <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                  Tokens
                </p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-bold tabular-nums text-cyan-400">
                    {formatTokens(totalIn)}
                    <span className="ml-0.5 text-2xs font-normal text-muted-foreground">in</span>
                  </span>
                  <span className="text-lg font-bold tabular-nums text-emerald-400">
                    {formatTokens(totalOut)}
                    <span className="ml-0.5 text-2xs font-normal text-muted-foreground">out</span>
                  </span>
                </p>
              </div>
            </div>
          );
        })()}
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 pb-4 border-b border-border/50">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search runs... (/ to focus)"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
            }}
            className="pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setInputValue('');
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setFilter('status', v);
          }}
        >
          <SelectTrigger className="w-32" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {workflows.length > 1 && (
          <Select
            value={workflowFilter}
            onValueChange={(v) => {
              setFilter('workflow', v);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Filter by workflow">
              <SelectValue placeholder="Workflow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workflows</SelectItem>
              {workflows.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowDeleteModal(true);
              }}
            >
              <Trash2 className="size-4" />
              Delete ({selected.size})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              void Promise.resolve(navigate('/runs/new'));
            }}
            title="New Run (N)"
          >
            <Plus className="size-4" />
            New Run
          </Button>
        </div>
      </div>

      {/* Table or empty filtered state */}
      {sortedRuns.length === 0 && hasActiveFilters ? (
        <EmptyState
          icon={Search}
          title="No runs match your filters"
          description="Try adjusting your search query or filters"
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Mobile card view */}
          <div className="flex flex-1 flex-col gap-3 overflow-auto motion-safe:animate-fade-in md:hidden">
            {pagedRuns.map((run) => (
              <ContextMenu
                key={run.runId}
                onOpenChange={(open) => {
                  if (open) {
                    setContextTarget(run.runId);
                  }
                }}
              >
                <ContextMenuTrigger asChild>
                  <div
                    className="cursor-pointer rounded-lg bg-card/80 p-4 ring-1 ring-white/[0.04] transition-all duration-200 hover:ring-white/[0.08]"
                    onClick={() => {
                      void Promise.resolve(navigate(`/runs/${run.runId}`));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void Promise.resolve(navigate(`/runs/${run.runId}`));
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{run.runId}</span>
                      <StatusBadge status={run.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {run.repoRoot && (
                        <span title={run.repoRoot}>{formatRepoPath(run.repoRoot)}</span>
                      )}
                      <span>{run.workflow}</span>
                      <span>{formatDuration(run.durationMs)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span title={formatDate(run.startedAt)}>{timeago(run.startedAt)}</span>
                      <TokenDisplay input={run.totalInputTokens} output={run.totalOutputTokens} />
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem variant="destructive" onClick={handleContextDelete}>
                    <Trash2 className="size-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>

          {/* Desktop table view */}
          <div
            className="hidden flex-1 overflow-auto rounded-lg bg-card/80 ring-1 ring-white/[0.04] backdrop-blur-sm motion-safe:animate-fade-in md:block"
            data-testid="runs-table"
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      className="cursor-pointer"
                      checked={
                        pagedRuns.length > 0 && pagedRuns.every((r) => selected.has(r.runId))
                          ? true
                          : pagedRuns.some((r) => selected.has(r.runId))
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={() => {
                        const pageIds = pagedRuns.map((r) => r.runId);
                        const allSelected = pageIds.every((id) => selected.has(id));
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const id of pageIds) {
                            if (allSelected) {
                              next.delete(id);
                            } else {
                              next.add(id);
                            }
                          }
                          return next;
                        });
                      }}
                      aria-label="Select all runs on this page"
                    />
                  </TableHead>
                  {(
                    [
                      ['runId', 'Run ID', false],
                      ['context', 'Context', true],
                      ['workflow', 'Workflow', true],
                      ['status', 'Status', false],
                      ['startedAt', 'Started', false],
                      ['durationMs', 'Duration', true],
                      ['totalArtifacts', 'Artifacts', true],
                      ['tokens', 'Tokens', true],
                    ] as const
                  ).map(([key, label, hiddenOnMobile]) => (
                    <TableHead
                      key={key}
                      className={cn(
                        'cursor-pointer select-none hover:text-foreground',
                        hiddenOnMobile && 'hidden lg:table-cell',
                      )}
                      onClick={() => {
                        handleSort(key);
                      }}
                      aria-sort={
                        sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      {label}
                      {sortKey === key ? (
                        <span className="ml-1 text-primary">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      ) : (
                        <span className="ml-1 text-muted-foreground/30">▲</span>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRuns.map((run) => (
                  <ContextMenu
                    key={run.runId}
                    onOpenChange={(open) => {
                      if (open) {
                        setContextTarget(run.runId);
                      }
                    }}
                  >
                    <ContextMenuTrigger asChild>
                      <TableRow
                        onClick={() => {
                          void Promise.resolve(navigate(`/runs/${run.runId}`));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void Promise.resolve(navigate(`/runs/${run.runId}`));
                          }
                        }}
                        tabIndex={0}
                        role="link"
                        className="cursor-pointer transition-colors hover:bg-primary/[0.04]"
                      >
                        <TableCell>
                          <Checkbox
                            className="cursor-pointer"
                            checked={selected.has(run.runId)}
                            onCheckedChange={() => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(run.runId)) {
                                  next.delete(run.runId);
                                } else {
                                  next.add(run.runId);
                                }
                                return next;
                              });
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            aria-label={`Select run ${run.runId}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{run.runId}</TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                          <span className="inline-flex items-center gap-1.5">
                            <span title={run.repoRoot ?? ''}>{formatRepoPath(run.repoRoot)}</span>
                            {run.sources && run.sources.length > 0 && (
                              <PromptTrigger
                                onClick={() => {
                                  setPromptToShow(run.sources?.join(' ') ?? '');
                                }}
                              />
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {run.workflow}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          title={formatDate(run.startedAt)}
                        >
                          {timeago(run.startedAt)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {formatDuration(run.durationMs)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {run.totalArtifacts}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <TokenDisplay
                            input={run.totalInputTokens}
                            output={run.totalOutputTokens}
                          />
                        </TableCell>
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem variant="destructive" onClick={handleContextDelete}>
                        <Trash2 className="size-4" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Pagination */}
      {sortedRuns.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border/50 pt-3 mt-3">
          <p className="text-xs text-muted-foreground">
            {(safeCurrentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(safeCurrentPage * PAGE_SIZE, sortedRuns.length)} of {sortedRuns.length} runs
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safeCurrentPage <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
              }}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                variant={p === safeCurrentPage ? 'default' : 'outline'}
                size="icon-sm"
                onClick={() => {
                  setPage(p);
                }}
                aria-label={`Page ${String(p)}`}
                aria-current={p === safeCurrentPage ? 'page' : undefined}
              >
                {p}
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Runs</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteLabel}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteModal(false);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleDeleteConfirmed();
              }}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PromptDialog
        prompt={promptToShow}
        open={promptToShow !== null}
        onOpenChange={(v) => {
          if (!v) {
            setPromptToShow(null);
          }
        }}
      />
    </div>
  );
}
