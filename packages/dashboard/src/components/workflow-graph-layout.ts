import type { TransitionEdge, WorkflowStateView } from '@ai-orchestrator/schemas';

/** Horizontal distance between main spine and side columns. */
export const COLUMN_OFFSET_PX = 380;

/**
 * Trigger keywords that indicate "happy path" forward progress.
 * Transitions with these triggers are preferred when deriving the spine.
 */
const HAPPY_TRIGGERS = [
  'completion',
  'completed',
  'human_approved',
  'review_approved',
  'judge_approved',
];

function triggerPriority(trigger: string): number {
  const idx = HAPPY_TRIGGERS.findIndex((h) => trigger.includes(h));
  return idx >= 0 ? idx : HAPPY_TRIGGERS.length;
}

/**
 * Derive the main-path spine from the workflow's transitions via greedy DFS.
 * Prefers "happy path" triggers (completion, approved, etc.) and avoids
 * revisiting states. The result is a linear ordering of spine states.
 */
export function deriveSpine(workflow: WorkflowStateView): string[] {
  const stateIds = new Set(workflow.states.map((s) => s.id));
  const terminalIds = new Set(
    workflow.states.filter((s) => s.type === 'terminal').map((s) => s.id),
  );
  const adj = new Map<string, TransitionEdge[]>();
  for (const t of workflow.transitions) {
    const list = adj.get(t.from) ?? [];
    list.push(t);
    adj.set(t.from, list);
  }

  const incoming = new Set(workflow.transitions.map((t) => t.to));
  const initial =
    workflow.states.find((s) => !incoming.has(s.id) && s.type !== 'terminal')?.id ??
    workflow.states[0]?.id;

  if (!initial) {
    return [];
  }

  const spine: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = initial;

  for (;;) {
    while (current && !visited.has(current)) {
      spine.push(current);
      visited.add(current);

      const outgoing = (adj.get(current) ?? [])
        .filter((t) => !visited.has(t.to) && !terminalIds.has(t.to) && stateIds.has(t.to))
        .sort((a, b) => triggerPriority(a.trigger) - triggerPriority(b.trigger));

      current = outgoing[0]?.to;
    }

    let resumed = false;
    for (let i = spine.length - 1; i >= 0; i--) {
      const candidates = (adj.get(spine[i]) ?? [])
        .filter((t) => !visited.has(t.to) && !terminalIds.has(t.to) && stateIds.has(t.to))
        .sort((a, b) => triggerPriority(a.trigger) - triggerPriority(b.trigger));
      if (candidates.length > 0) {
        current = candidates[0].to;
        resumed = true;
        break;
      }
    }
    if (!resumed) {
      break;
    }
  }

  if (!spine.includes('DONE') && stateIds.has('DONE')) {
    spine.push('DONE');
  }

  return spine;
}

type StateRole = 'main' | 'branch' | 'terminal-branch';

export type EdgeCategory = 'forward' | 'backward' | 'abort';

interface ClassifiedState {
  readonly id: string;
  readonly role: StateRole;
  /** Column index: 0 = spine, negative = left, positive = right. */
  readonly column: number;
  /** Rank among main-path states (undefined for branches). */
  readonly spineIndex?: number;
}

export function classifyStates(workflow: WorkflowStateView): ReadonlyMap<string, ClassifiedState> {
  const spine = deriveSpine(workflow);
  const result = new Map<string, ClassifiedState>();

  for (const [index, id] of spine.entries()) {
    result.set(id, { id, role: 'main', column: 0, spineIndex: index });
  }

  for (const s of workflow.states) {
    if (result.has(s.id)) {
      continue;
    }
    if (s.id === 'ABORTED' || (s.type === 'terminal' && s.id !== 'DONE')) {
      result.set(s.id, { id: s.id, role: 'terminal-branch', column: 1 });
      continue;
    }
    result.set(s.id, { id: s.id, role: 'branch', column: -1 });
  }

  return result;
}

export function spineOrder(workflow: WorkflowStateView): Map<string, number> {
  const classified = classifyStates(workflow);
  const order = new Map<string, number>();
  for (const [id, info] of classified) {
    if (info.spineIndex !== undefined) {
      order.set(id, info.spineIndex);
    }
  }
  // Fallback: include non-spine states after spine for backward detection
  let next = order.size;
  for (const s of workflow.states) {
    if (!order.has(s.id)) {
      order.set(s.id, next++);
    }
  }
  return order;
}

export function categorizeEdge(
  transition: TransitionEdge,
  stateOrder: ReadonlyMap<string, number>,
): EdgeCategory {
  if (transition.to === 'DONE') {
    return 'forward';
  }
  if (transition.to === 'ABORTED') {
    return 'abort';
  }
  const fromIdx = stateOrder.get(transition.from);
  const toIdx = stateOrder.get(transition.to);
  if (fromIdx !== undefined && toIdx !== undefined && toIdx < fromIdx) {
    return 'backward';
  }
  return 'forward';
}

export function shouldShowEdgeLabel(transition: TransitionEdge, _category: EdgeCategory): boolean {
  return transition.traversed;
}

function columnX(column: number, centerX: number): number {
  return centerX + column * COLUMN_OFFSET_PX;
}

/** Vertical spacing between consecutive spine ranks. */
const SPINE_RANK_SEP_PX = 160;

interface NodePosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Explicit hierarchical positions: spine is a vertical column with
 * monotonic Y by spineIndex so same-rank dagre collisions cannot stack nodes.
 */
export function layoutPositions(
  workflow: WorkflowStateView,
  centerX = 400,
): ReadonlyMap<string, NodePosition> {
  const classified = classifyStates(workflow);
  const positions = new Map<string, NodePosition>();

  // Spine first — fixed vertical order
  for (const [id, info] of classified) {
    if (info.spineIndex === undefined) {
      continue;
    }
    positions.set(id, {
      x: columnX(0, centerX),
      y: info.spineIndex * SPINE_RANK_SEP_PX,
    });
  }

  // Branches: place beside the nearest related spine node by transition, else mid-spine
  const spineYs = [...positions.values()].map((p) => p.y);
  const midY = spineYs.length > 0 ? spineYs.reduce((a, b) => a + b, 0) / spineYs.length : 0;
  const maxSpineY = spineYs.length > 0 ? Math.max(...spineYs) : 0;

  for (const s of workflow.states) {
    if (positions.has(s.id)) {
      continue;
    }
    const info = classified.get(s.id);
    const column = info?.column ?? -1;

    if (info?.role === 'terminal-branch') {
      positions.set(s.id, {
        x: columnX(column, centerX),
        y: maxSpineY,
      });
    } else {
      const relatedSpineY = findRelatedSpineY(s.id, workflow, classified, positions);
      positions.set(s.id, {
        x: columnX(column, centerX),
        y: relatedSpineY ?? midY,
      });
    }
  }

  // Nudge overlapping branch nodes that share the same column+y
  resolveBranchCollisions(positions, classified);

  // Synthetic START / END markers
  const minSpineY = spineYs.length > 0 ? Math.min(...spineYs) : 0;
  positions.set('__START__', { x: columnX(0, centerX), y: minSpineY - SPINE_RANK_SEP_PX });
  positions.set('__END__', { x: columnX(0, centerX), y: maxSpineY + SPINE_RANK_SEP_PX });

  return positions;
}

function findRelatedSpineY(
  stateId: string,
  workflow: WorkflowStateView,
  classified: ReadonlyMap<string, ClassifiedState>,
  positions: ReadonlyMap<string, NodePosition>,
): number | undefined {
  const relatedYs: number[] = [];
  for (const t of workflow.transitions) {
    if (t.from === stateId) {
      const target = classified.get(t.to);
      if (target?.spineIndex !== undefined) {
        const y = positions.get(t.to)?.y;
        if (y !== undefined) {
          relatedYs.push(y);
        }
      }
    }
    if (t.to === stateId) {
      const source = classified.get(t.from);
      if (source?.spineIndex !== undefined) {
        const y = positions.get(t.from)?.y;
        if (y !== undefined) {
          relatedYs.push(y);
        }
      }
    }
  }
  if (relatedYs.length === 0) {
    return undefined;
  }
  return relatedYs.reduce((a, b) => a + b, 0) / relatedYs.length;
}

function resolveBranchCollisions(
  positions: Map<string, NodePosition>,
  classified: ReadonlyMap<string, ClassifiedState>,
): void {
  const byKey = new Map<string, string[]>();
  for (const [id, info] of classified) {
    if (info.column === 0) {
      continue;
    }
    const pos = positions.get(id);
    if (!pos) {
      continue;
    }
    const key = `${String(info.column)}:${String(pos.y)}`;
    const list = byKey.get(key) ?? [];
    list.push(id);
    byKey.set(key, list);
  }
  for (const ids of byKey.values()) {
    if (ids.length < 2) {
      continue;
    }
    ids.forEach((id, index) => {
      const pos = positions.get(id);
      if (!pos) {
        return;
      }
      positions.set(id, { x: pos.x, y: pos.y + index * SPINE_RANK_SEP_PX });
    });
  }
}

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

/** Convert a STATE_ID into a readable label via title-casing. */
export function humanizeStateLabel(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------------------------------------------------
// State type indicators
// ---------------------------------------------------------------------------

const STATE_TYPE_ICONS: Record<string, string> = {
  action: '\u25B6', // ▶
  review: '\u25C9', // ◉
  judge: '\u2696', // ⚖
  gate: '\u26A0', // ⚠
  wait: '\u23F3', // ⏳
  terminal: '\u2B24', // ⬤
  script: '\u2699', // ⚙
};

/** Small icon/symbol representing a state type. */
export function stateTypeIcon(type: string): string {
  return STATE_TYPE_ICONS[type] ?? '\u25CF'; // ●
}

// ---------------------------------------------------------------------------
// Progress calculation
// ---------------------------------------------------------------------------

export interface WorkflowProgress {
  /** 1-based index of the current step on the main path (0 if not started). */
  readonly currentStep: number;
  /** Total main-path steps. */
  readonly totalSteps: number;
  /** 0–100 percentage. */
  readonly percent: number;
  /** True if the workflow reached a terminal state. */
  readonly isComplete: boolean;
}

export function computeProgress(workflow: WorkflowStateView): WorkflowProgress {
  const spine = deriveSpine(workflow);
  const total = spine.length;
  const terminal = workflow.states.find((s) => s.type === 'terminal' && s.current);
  if (terminal) {
    return { currentStep: total, totalSteps: total, percent: 100, isComplete: true };
  }
  let currentIdx = spine.indexOf(workflow.currentState);
  if (currentIdx < 0) {
    const visited = new Set(workflow.visitedStates);
    for (let i = spine.length - 1; i >= 0; i--) {
      if (visited.has(spine[i])) {
        currentIdx = i;
        break;
      }
    }
  }
  const step = currentIdx >= 0 ? currentIdx + 1 : 0;
  const percent = total > 0 ? Math.round((step / total) * 100) : 0;
  return { currentStep: step, totalSteps: total, percent, isComplete: false };
}
