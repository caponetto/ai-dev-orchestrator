import type { RoleAssignmentView, StateNode as StateNodeData } from '@ai-orchestrator/schemas';
import type { Edge, EdgeMarker, Node } from '@xyflow/react';
import type { CSSProperties } from 'react';

import { humanize } from '../lib/humanize';

import { categorizeEdge } from './workflow-graph-layout';
import {
  edgeDash,
  edgeOpacity,
  edgeStroke,
  GROUP_BOTTOM_PAD,
  GROUP_H_PAD,
  GROUP_TOP_PAD,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeLabel,
  nodeOpacity,
  resolveBorderColor,
  resolveNodeBackground,
  resolveRunnerInfo,
  resolveSubBackground,
  stateTypeColors,
  subNodeLabel,
} from './workflow-graph-nodes';

export interface RawEdge {
  source: string;
  target: string;
  t: { from: string; to: string; trigger: string; traversed: boolean; traversalCount: number };
  idx: number;
}

export function repositionAbortedNode(
  positions: Map<string, { x: number; y: number }>,
  transitions: readonly { from: string; to: string; traversed: boolean }[],
  nodeHeight: number,
): void {
  const abortSource = transitions.find((t) => t.to === 'ABORTED' && t.traversed);
  if (abortSource) {
    const sourcePos = positions.get(abortSource.from);
    const abortPos = positions.get('ABORTED');
    if (sourcePos && abortPos) {
      positions.set('ABORTED', { x: abortPos.x, y: sourcePos.y + nodeHeight + 40 });
    }
  }
}

export function buildNodeStyle(opts: {
  background: string;
  borderColor: string;
  isTerminal: boolean;
  fontWeight: number;
  preview: boolean | undefined;
  opacity: number;
  width: number;
  height: number;
  current: boolean;
}): CSSProperties {
  return {
    background: opts.background,
    color: opts.preview ? '#e2e8f0' : '#f9fafb',
    border: `2px solid ${opts.borderColor}`,
    borderRadius: opts.isTerminal ? 16 : 8,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: opts.fontWeight,
    opacity: opts.opacity,
    width: opts.width,
    height: opts.height,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'pre-line',
    textAlign: 'center',
    boxShadow: opts.current ? '0 0 0 3px rgba(147, 197, 253, 0.35)' : undefined,
  };
}

export function createParallelSubNodes(
  s: StateNodeData,
  parallelRoles: readonly string[],
  pos: { x: number; y: number },
  role: string,
  preview: boolean | undefined,
  currentStateElapsedMs: number | undefined,
  roleAssignments: readonly RoleAssignmentView[] | undefined,
): { nodes: Node[]; subIds: string[] } {
  const subW = NODE_WIDTH;
  const subH = NODE_HEIGHT;
  const gap = 16;
  const innerW = parallelRoles.length * subW + (parallelRoles.length - 1) * gap;
  const groupW = innerW + 2 * GROUP_H_PAD;
  const groupH = subH + GROUP_TOP_PAD + GROUP_BOTTOM_PAD;
  const groupId = `${s.id}__group`;

  const subIds: string[] = [];
  const result: Node[] = [];

  result.push({
    id: groupId,
    type: 'parallelGroup',
    position: { x: pos.x - groupW / 2, y: pos.y - groupH / 2 },
    data: { label: humanize(s.label) },
    width: groupW,
    height: groupH,
    measured: { width: groupW, height: groupH },
    style: { width: groupW, height: groupH },
  });

  for (let ri = 0; ri < parallelRoles.length; ri++) {
    const pr = parallelRoles[ri];
    const subId = `${s.id}__${pr}`;
    subIds.push(subId);

    const roleDone = (s.parallelInfo?.roleDurations?.[pr] ?? 0) > 0;
    const active = s.current && !roleDone;

    const typeColor = stateTypeColors[s.type] ?? '#6b7280';
    const subBg = resolveSubBackground(preview, active, typeColor, role);
    const subBorder = resolveBorderColor(preview, active, s.visited || roleDone, typeColor);
    const label = subNodeLabel(pr, s, currentStateElapsedMs);

    result.push({
      id: subId,
      type: 'multiHandle',
      parentId: groupId,
      extent: 'parent' as const,
      position: { x: GROUP_H_PAD + ri * (subW + gap), y: GROUP_TOP_PAD },
      data: { label, roles: [pr], runnerInfo: resolveRunnerInfo([pr], roleAssignments) },
      className: active ? 'state-pulse' : undefined,
      width: subW,
      height: subH,
      measured: { width: subW, height: subH },
      style: buildNodeStyle({
        background: subBg,
        borderColor: subBorder,
        isTerminal: false,
        fontWeight: active ? 700 : 500,
        preview,
        opacity: nodeOpacity(s, role, preview),
        width: subW,
        height: subH,
        current: active,
      }),
    });
  }

  return { nodes: result, subIds };
}

const MAX_VISIBLE_DYNAMIC_NODES = 5;

export function createDynamicParallelSubNodes(
  s: StateNodeData,
  dynamicRole: string,
  count: number,
  pos: { x: number; y: number },
  role: string,
  preview: boolean | undefined,
  currentStateElapsedMs: number | undefined,
  roleAssignments: readonly RoleAssignmentView[] | undefined,
  unknownCount?: boolean,
): { nodes: Node[]; subIds: string[] } {
  const subW = NODE_WIDTH;
  const subH = NODE_HEIGHT;
  const gap = 16;
  const visibleCount = Math.min(count, MAX_VISIBLE_DYNAMIC_NODES);
  const hasOverflow = count > MAX_VISIBLE_DYNAMIC_NODES || !!unknownCount;
  const totalSlots = visibleCount + (hasOverflow ? 1 : 0);
  const innerW = totalSlots * subW + (totalSlots - 1) * gap;
  const groupW = innerW + 2 * GROUP_H_PAD;
  const groupH = subH + GROUP_TOP_PAD + GROUP_BOTTOM_PAD;
  const groupId = `${s.id}__group`;

  const subIds: string[] = [];
  const result: Node[] = [];

  result.push({
    id: groupId,
    type: 'parallelGroup',
    position: { x: pos.x - groupW / 2, y: pos.y - groupH / 2 },
    data: { label: humanize(s.label) },
    width: groupW,
    height: groupH,
    measured: { width: groupW, height: groupH },
    style: { width: groupW, height: groupH },
  });

  const roleName = humanize(dynamicRole);
  for (let i = 0; i < visibleCount; i++) {
    const subId = `${s.id}__${dynamicRole}#${String(i + 1)}`;
    subIds.push(subId);

    const active = s.current && !preview;
    const typeColor = stateTypeColors[s.type] ?? '#6b7280';
    const subBg = resolveSubBackground(preview, active, typeColor, role);
    const subBorder = resolveBorderColor(preview, active, s.visited, typeColor);
    const label = `${roleName} #${String(i + 1)}`;

    result.push({
      id: subId,
      type: 'multiHandle',
      parentId: groupId,
      extent: 'parent' as const,
      position: { x: GROUP_H_PAD + i * (subW + gap), y: GROUP_TOP_PAD },
      data: {
        label,
        roles: [dynamicRole],
        runnerInfo: resolveRunnerInfo([dynamicRole], roleAssignments),
      },
      className: active ? 'state-pulse' : undefined,
      width: subW,
      height: subH,
      measured: { width: subW, height: subH },
      style: buildNodeStyle({
        background: subBg,
        borderColor: subBorder,
        isTerminal: false,
        fontWeight: active ? 700 : 500,
        preview,
        opacity: nodeOpacity(s, role, preview),
        width: subW,
        height: subH,
        current: active,
      }),
    });
  }

  if (hasOverflow) {
    const overflowId = `${s.id}__overflow`;
    const overflowLabel = unknownCount
      ? '...'
      : `+${String(count - MAX_VISIBLE_DYNAMIC_NODES)} more`;
    result.push({
      id: overflowId,
      type: 'multiHandle',
      parentId: groupId,
      extent: 'parent' as const,
      position: { x: GROUP_H_PAD + visibleCount * (subW + gap), y: GROUP_TOP_PAD },
      data: { label: overflowLabel, roles: [dynamicRole] },
      width: subW,
      height: subH,
      measured: { width: subW, height: subH },
      style: {
        ...buildNodeStyle({
          background: 'transparent',
          borderColor: '#4b5563',
          isTerminal: false,
          fontWeight: 500,
          preview,
          opacity: 0.7,
          width: subW,
          height: subH,
          current: false,
        }),
        borderStyle: 'dashed',
      },
    });
    subIds.push(overflowId);
  }

  return { nodes: result, subIds };
}

export function createRegularNode(
  s: StateNodeData,
  pos: { x: number; y: number },
  role: string,
  preview: boolean | undefined,
  currentStateElapsedMs: number | undefined,
  roleAssignments: readonly RoleAssignmentView[] | undefined,
): Node {
  const w = NODE_WIDTH;
  const h = NODE_HEIGHT;
  const label = nodeLabel(s, s.current ? currentStateElapsedMs : undefined);

  const isAborted = s.id === 'ABORTED';
  const typeColor = isAborted ? '#ef4444' : (stateTypeColors[s.type] ?? '#6b7280');
  const isTerminal = s.type === 'terminal';
  const background = resolveNodeBackground({
    preview,
    current: s.current,
    typeColor,
    isTerminal,
    isAborted,
    role,
  });
  const borderColor = resolveBorderColor(preview, s.current, s.visited, typeColor);

  return {
    id: s.id,
    type: 'multiHandle',
    position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    data: {
      label,
      roles: s.roles,
      scripts: s.scripts,
      runnerInfo: resolveRunnerInfo(s.roles, roleAssignments),
    },
    className: s.current ? 'state-pulse' : undefined,
    width: w,
    height: h,
    measured: { width: w, height: h },
    style: buildNodeStyle({
      background,
      borderColor,
      isTerminal,
      fontWeight: s.current ? 700 : role === 'main' ? 500 : 400,
      preview,
      opacity: nodeOpacity(s, role, preview),
      width: w,
      height: h,
      current: s.current,
    }),
  };
}

export function buildSyntheticSpineTransitions(
  spineIds: readonly string[],
  existingEdgeKeys: ReadonlySet<string>,
): { from: string; to: string; trigger: string; traversed: boolean; traversalCount: number }[] {
  const result: {
    from: string;
    to: string;
    trigger: string;
    traversed: boolean;
    traversalCount: number;
  }[] = [];
  for (let i = 0; i < spineIds.length - 1; i++) {
    const from = spineIds[i];
    const to = spineIds[i + 1];
    if (!existingEdgeKeys.has(`${from}->${to}`)) {
      result.push({ from, to, trigger: 'completion', traversed: false, traversalCount: 0 });
    }
  }
  return result;
}

export function buildSyntheticAbortTransition(
  currentId: string | undefined,
  stateHistory: readonly string[],
  transitions: readonly {
    from: string;
    to: string;
    trigger: string;
    traversed: boolean;
    traversalCount: number;
  }[],
  existingEdgeKeys: ReadonlySet<string>,
): {
  transitions: {
    from: string;
    to: string;
    trigger: string;
    traversed: boolean;
    traversalCount: number;
  }[];
  historyPredecessor: string | undefined;
} {
  const historyPredecessor: string | undefined =
    currentId === 'ABORTED' ? [...stateHistory].reverse().find((s) => s !== 'ABORTED') : undefined;

  const result: {
    from: string;
    to: string;
    trigger: string;
    traversed: boolean;
    traversalCount: number;
  }[] = [];

  if (currentId === 'ABORTED') {
    const hasTraversedAbortEdge = transitions.some((t) => t.to === 'ABORTED' && t.traversed);
    if (!hasTraversedAbortEdge && historyPredecessor) {
      if (!existingEdgeKeys.has(`${historyPredecessor}->ABORTED`)) {
        result.push({
          from: historyPredecessor,
          to: 'ABORTED',
          trigger: 'abort',
          traversed: true,
          traversalCount: 1,
        });
      }
    }
  }

  return { transitions: result, historyPredecessor };
}

export function expandTransitionsToRawEdges(
  allTransitions: readonly {
    from: string;
    to: string;
    trigger: string;
    traversed: boolean;
    traversalCount: number;
  }[],
  spine: readonly string[],
  order: ReadonlyMap<string, number>,
  parallelSubIds: ReadonlyMap<string, string[]>,
  currentId: string | undefined,
  abortPredecessor: string | undefined,
): RawEdge[] {
  const spineSet = new Set(spine);
  const rawEdges: RawEdge[] = [];
  let edgeIdx = 0;

  for (const t of allTransitions) {
    if (t.from === t.to) {
      continue;
    }

    const cat = categorizeEdge(t, order);
    const isAbortFromPredecessor =
      cat === 'abort' && t.to === 'ABORTED' && t.from === abortPredecessor;

    const bothOnSpine = spineSet.has(t.from) && spineSet.has(t.to);
    if (cat !== 'forward' && !t.traversed && !isAbortFromPredecessor && !bothOnSpine) {
      continue;
    }

    const involvesBranch = !spineSet.has(t.from) || !spineSet.has(t.to);
    if (involvesBranch && !t.traversed && t.from !== currentId && !isAbortFromPredecessor) {
      continue;
    }

    const fromSubs = parallelSubIds.get(t.from);
    const toSubs = parallelSubIds.get(t.to);

    if (fromSubs && toSubs) {
      for (const fs of fromSubs) {
        for (const ts of toSubs) {
          rawEdges.push({ source: fs, target: ts, t, idx: edgeIdx++ });
        }
      }
    } else if (fromSubs) {
      for (const fs of fromSubs) {
        rawEdges.push({ source: fs, target: t.to, t, idx: edgeIdx++ });
      }
    } else if (toSubs) {
      for (const ts of toSubs) {
        rawEdges.push({ source: t.from, target: ts, t, idx: edgeIdx++ });
      }
    } else {
      rawEdges.push({ source: t.from, target: t.to, t, idx: edgeIdx++ });
    }
  }

  return rawEdges;
}

export function buildStyledEdges(
  rawEdges: readonly RawEdge[],
  order: ReadonlyMap<string, number>,
  abortPredecessor: string | undefined,
  terminal: boolean,
  preview: boolean | undefined,
): Edge[] {
  return rawEdges.map(({ source, target, t, idx }) => {
    const category = categorizeEdge(t, order);
    const traversed =
      t.traversed || (category === 'abort' && t.to === 'ABORTED' && t.from === abortPredecessor);
    const strokeColor = edgeStroke(category, traversed);
    const marker: EdgeMarker = {
      type: 'arrowclosed' as const,
      color: strokeColor,
      width: 16,
      height: 16,
    };

    const isBackward = category === 'backward';
    const fromSpineIdx = order.get(source);
    const toSpineIdx = order.get(target);
    const skipsSpineNodes =
      category === 'forward' &&
      !isBackward &&
      fromSpineIdx !== undefined &&
      toSpineIdx !== undefined &&
      toSpineIdx - fromSpineIdx > 1;

    return {
      id: `e-${String(idx)}`,
      source,
      target,
      sourceHandle: isBackward ? 'left-out' : skipsSpineNodes ? 'right-out' : 'bottom',
      targetHandle: isBackward ? 'left-in' : skipsSpineNodes ? 'right-in' : 'top',
      type: 'smoothstep',
      pathOptions: { borderRadius: 20, offset: 20 },
      data: { trigger: t.trigger, category },
      animated: false,
      markerEnd: marker,
      style: {
        stroke: strokeColor,
        strokeWidth: traversed ? 2.5 : 1.5,
        strokeDasharray: terminal
          ? undefined
          : traversed
            ? undefined
            : edgeDash(category, traversed),
        opacity: edgeOpacity(category, traversed, preview),
      },
    };
  });
}

export function annotateHandleVisibility(nodes: Node[], edges: readonly Edge[]): void {
  const sourceIds = new Set(edges.map((e) => e.source));
  const targetIds = new Set(edges.map((e) => e.target));
  for (const n of nodes) {
    const classes: string[] = [];
    if (n.className) {
      classes.push(n.className);
    }
    if (!sourceIds.has(n.id)) {
      classes.push('hide-handle-bottom');
    }
    if (!targetIds.has(n.id)) {
      classes.push('hide-handle-top');
    }
    if (classes.length > 0) {
      (n as Record<string, unknown>).className = classes.join(' ');
    }
  }
}
