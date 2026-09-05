import type { RoleAssignmentView, WorkflowStateView } from '@ai-dev-orchestrator/schemas';
import {
  Background,
  ControlButton,
  Controls,
  type EdgeMarker,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../lib/utils';

import { computeElkPositions, MARKER_HEIGHT, MARKER_WIDTH } from './elk-layout';
import {
  annotateHandleVisibility,
  buildSyntheticAbortTransition,
  buildSyntheticSpineTransitions,
  buildStyledEdges,
  createDynamicParallelSubNodes,
  createParallelSubNodes,
  createRegularNode,
  expandTransitionsToRawEdges,
  repositionAbortedNode,
} from './workflow-graph-builders';
import { classifyStates, deriveSpine, layoutPositions, spineOrder } from './workflow-graph-layout';
import { GraphLegend, NODE_HEIGHT, nodeTypes, stateTypeColors } from './workflow-graph-nodes';
import './WorkflowGraph.css';

function buildGraph(
  workflow: WorkflowStateView,
  layoutPos: ReadonlyMap<string, { x: number; y: number }>,
  currentStateElapsedMs?: number,
  preview?: boolean,
  roleAssignments?: readonly RoleAssignmentView[],
) {
  const classified = classifyStates(workflow);
  const order = spineOrder(workflow);
  const positions = new Map(layoutPos);
  const abortReached = workflow.states.some((s) => s.id === 'ABORTED' && s.current);

  if (abortReached) {
    repositionAbortedNode(positions, workflow.transitions, NODE_HEIGHT);
  }

  const parallelSubIds = new Map<string, string[]>();
  const currentId = workflow.states.find((s) => s.current)?.id;
  const nodes: Node[] = [];

  for (const s of workflow.states) {
    if (s.id === 'ABORTED' && !abortReached) {
      continue;
    }
    const info = classified.get(s.id);
    const isSpine = info?.role === 'main';
    if (!isSpine && !s.visited && !s.current) {
      continue;
    }
    const role = info?.role ?? 'main';
    const parallelRoles = s.parallelInfo?.parallelRoles ?? [];
    const dynamicRole = s.parallelInfo?.dynamicRole;
    const dynamicWorkerCount = s.parallelInfo?.dynamicWorkerCount;

    if (parallelRoles.length > 1) {
      const { nodes: subNodes, subIds } = createParallelSubNodes(
        s,
        parallelRoles,
        positions.get(s.id) ?? { x: 0, y: 0 },
        role,
        preview,
        currentStateElapsedMs,
        roleAssignments,
      );
      nodes.push(...subNodes);
      parallelSubIds.set(s.id, subIds);
      continue;
    }

    if (dynamicRole) {
      const count = dynamicWorkerCount ?? 2;
      const { nodes: subNodes, subIds } = createDynamicParallelSubNodes(
        s,
        dynamicRole,
        count,
        positions.get(s.id) ?? { x: 0, y: 0 },
        role,
        preview,
        currentStateElapsedMs,
        roleAssignments,
        dynamicWorkerCount === undefined,
      );
      nodes.push(...subNodes);
      parallelSubIds.set(s.id, subIds);
      continue;
    }

    nodes.push(
      createRegularNode(
        s,
        positions.get(s.id) ?? { x: 0, y: 0 },
        role,
        preview,
        currentStateElapsedMs,
        roleAssignments,
      ),
    );
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const existingEdgeKeys = new Set(workflow.transitions.map((t) => `${t.from}->${t.to}`));
  const spine = deriveSpine(workflow);
  const spineIds = spine.filter((id) => nodeIds.has(id) || [...parallelSubIds.keys()].includes(id));

  const syntheticSpine = buildSyntheticSpineTransitions(spineIds, existingEdgeKeys);
  const { transitions: syntheticAbort, historyPredecessor } = buildSyntheticAbortTransition(
    currentId,
    workflow.stateHistory,
    workflow.transitions,
    existingEdgeKeys,
  );

  const allTransitions = [...workflow.transitions, ...syntheticSpine, ...syntheticAbort];
  const abortPredecessor: string | undefined =
    currentId === 'ABORTED'
      ? (workflow.transitions.find((t) => t.to === 'ABORTED' && t.traversed)?.from ??
        historyPredecessor)
      : undefined;

  const rawEdges = expandTransitionsToRawEdges(
    allTransitions,
    spine,
    order,
    parallelSubIds,
    currentId,
    abortPredecessor,
  );

  const terminal = workflow.currentState === 'DONE' || workflow.currentState === 'ABORTED';
  const edges = buildStyledEdges(rawEdges, order, abortPredecessor, terminal, preview);

  // --- Synthetic START / END marker nodes ---
  const incomingSet = new Set(workflow.transitions.map((t) => t.to));
  const initialId =
    workflow.states.find((s) => !incomingSet.has(s.id) && s.type !== 'terminal')?.id ??
    workflow.states[0]?.id;

  const markerCircleStyle: CSSProperties = {
    background: '#831843',
    color: '#fda4af',
    border: '2px solid #ec4899',
    borderRadius: '50%',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    opacity: preview ? 0.7 : 0.85,
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const markerEdgeStyle: CSSProperties = {
    stroke: '#4b5563',
    strokeWidth: 1.5,
    strokeDasharray: '4 4',
    opacity: 0.5,
  };
  const markerArrow: EdgeMarker = {
    type: 'arrowclosed' as const,
    color: '#4b5563',
    width: 12,
    height: 12,
  };

  const startPos = initialId ? positions.get('__START__') : undefined;
  if (initialId && startPos) {
    nodes.push({
      id: '__START__',
      type: 'multiHandle',
      position: { x: startPos.x - MARKER_WIDTH / 2, y: startPos.y - MARKER_HEIGHT / 2 },
      data: { label: 'START' },
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT,
      measured: { width: MARKER_WIDTH, height: MARKER_HEIGHT },
      style: markerCircleStyle,
    });
    const startTarget = parallelSubIds.get(initialId)?.[0] ?? initialId;
    edges.push({
      id: 'e-__start__',
      source: '__START__',
      target: startTarget,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      type: 'smoothstep',
      animated: false,
      markerEnd: markerArrow,
      style: markerEdgeStyle,
    });
  }

  const visibleTerminalIds = nodes
    .filter((n) => {
      const s = workflow.states.find((st) => st.id === n.id);
      return s?.type === 'terminal';
    })
    .map((n) => n.id);

  const endPos = positions.get('__END__');
  if (visibleTerminalIds.length > 0 && endPos) {
    nodes.push({
      id: '__END__',
      type: 'multiHandle',
      position: { x: endPos.x - MARKER_WIDTH / 2, y: endPos.y - MARKER_HEIGHT / 2 },
      data: { label: 'END' },
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT,
      measured: { width: MARKER_WIDTH, height: MARKER_HEIGHT },
      style: markerCircleStyle,
    });
    for (const [ti, tid] of visibleTerminalIds.entries()) {
      edges.push({
        id: `e-__end__-${String(ti)}`,
        source: tid,
        target: '__END__',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'smoothstep',
        animated: false,
        markerEnd: markerArrow,
        style: markerEdgeStyle,
      });
    }
  }

  annotateHandleVisibility(nodes, edges);

  return { nodes, edges };
}

function workflowFingerprint(workflow: WorkflowStateView): string {
  const s = workflow.states
    .map(
      (n) =>
        `${n.id}:${String(n.visited)}:${String(n.current)}:${String(n.visitCount)}:${String(n.timeSpentMs)}:${n.parallelInfo?.parallelRoles?.join(',') ?? ''}:${n.roles?.join(',') ?? ''}:${
          n.parallelInfo?.roleDurations
            ? Object.entries(n.parallelInfo.roleDurations)
                .map(([r, d]) => `${r}=${String(d)}`)
                .join(',')
            : ''
        }`,
    )
    .join('|');
  const t = workflow.transitions
    .map((e) => `${e.from}-${e.to}:${String(e.traversed)}:${String(e.traversalCount)}`)
    .join('|');
  return `${s}##${t}`;
}

interface WorkflowGraphProps {
  workflow: WorkflowStateView;
  stateEnteredAt?: string;
  compact?: boolean;
  preview?: boolean;
  visible?: boolean;
  roleAssignments?: readonly RoleAssignmentView[];
}

function WorkflowGraphInner({
  workflow,
  stateEnteredAt,
  compact,
  preview,
  visible = true,
  roleAssignments,
}: Readonly<WorkflowGraphProps>) {
  const isActive = workflow.states.some((s) => s.current && s.type !== 'terminal');
  const [tick, setTick] = useState(0);
  const [elkPositions, setElkPositions] = useState<ReadonlyMap<
    string,
    { x: number; y: number }
  > | null>(null);

  const structureFp = useMemo(() => {
    const s = workflow.states
      .map((st) => `${st.id}:${String(st.parallelInfo?.parallelRoles?.length ?? 0)}`)
      .join('|');
    const t = workflow.transitions.map((tr) => `${tr.from}->${tr.to}`).join('|');
    return `${s}##${t}`;
  }, [workflow.states, workflow.transitions]);

  useEffect(() => {
    let cancelled = false;
    void computeElkPositions(workflow).then((pos) => {
      if (!cancelled) {
        setElkPositions(pos);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [structureFp]);

  useEffect(() => {
    if (!isActive || !stateEnteredAt) {
      return;
    }
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1_000);
    return () => {
      clearInterval(id);
    };
  }, [isActive, stateEnteredAt]);

  const currentStateElapsedMs =
    isActive && stateEnteredAt ? Date.now() - new Date(stateEnteredAt).getTime() : undefined;

  const graphFp = workflowFingerprint(workflow);
  const fallbackPositions = useMemo(() => layoutPositions(workflow), [structureFp]);
  const positions = elkPositions ?? fallbackPositions;
  const { nodes, edges } = useMemo(
    () => buildGraph(workflow, positions, currentStateElapsedMs, preview, roleAssignments),
    [positions, graphFp, tick, preview, roleAssignments],
  );
  const { fitView } = useReactFlow();
  const initialZoomDone = useRef(false);
  const lastCenteredState = useRef<string | null>(null);
  const prevVisible = useRef(visible);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      initialZoomDone.current = false;
    }
    prevVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (preview) {
      const frame = requestAnimationFrame(() => {
        void fitView({
          padding: 0.3,
          maxZoom: 1,
          duration: 300,
        });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    if (!elkPositions) {
      return;
    }

    const currentNode = nodes.find((n) => n.className?.includes('state-pulse'));
    const isTransition =
      currentNode &&
      lastCenteredState.current !== null &&
      lastCenteredState.current !== currentNode.id;

    if (!initialZoomDone.current || isTransition) {
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          if (currentNode) {
            void fitView({ nodes: [currentNode], padding: 1.2, maxZoom: 1.5, duration: 400 });
            lastCenteredState.current = currentNode.id;
          } else {
            void fitView({ padding: 0.2, maxZoom: 1.5 });
          }
          initialZoomDone.current = true;
        });
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }

    if (currentNode && lastCenteredState.current === null) {
      lastCenteredState.current = currentNode.id;
    }
  }, [fitView, nodes, preview, elkPositions, visible]);

  const focusCurrentState = useCallback(() => {
    const currentNode = nodes.find((n) => n.className?.includes('state-pulse'));
    if (currentNode) {
      void fitView({ nodes: [currentNode], padding: 1.2, maxZoom: 1.5, duration: 400 });
    } else {
      void fitView({ padding: 0.2, duration: 400 });
    }
  }, [fitView, nodes]);

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-border bg-card',
        compact ? 'h-full' : 'h-full min-h-[32rem]',
      )}
    >
      {!compact && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold text-foreground">Workflow</h3>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.5 }}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background color="#374151" gap={20} />
          <Controls showInteractive={false} className="workflow-controls">
            <ControlButton onClick={focusCurrentState} title="Focus current state">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M2 4.25A2.25 2.25 0 0 1 4.25 2h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 0-.75.75v2a.75.75 0 0 1-1.5 0v-2ZM13.75 2a.75.75 0 0 1 0 1.5h2a.75.75 0 0 1 .75.75v2a.75.75 0 0 0 1.5 0v-2A2.25 2.25 0 0 0 15.75 2h-2ZM3.5 13.75a.75.75 0 0 1 1.5 0v2c0 .414.336.75.75.75h2a.75.75 0 0 1 0 1.5h-2A2.25 2.25 0 0 1 3.5 15.75v-2ZM15 13.75a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 14.25 18h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 0 .75-.75v-2ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                  clipRule="evenodd"
                />
              </svg>
            </ControlButton>
          </Controls>
          <MiniMap
            nodeColor={(n) => {
              const baseId = n.id.includes('__') ? n.id.split('__')[0] : n.id;
              const s = workflow.states.find((st) => st.id === baseId);
              if (s?.current) {
                return baseId === 'ABORTED' ? '#ef4444' : (stateTypeColors[s.type] ?? '#3b82f6');
              }
              if (s?.visited) {
                return baseId === 'ABORTED' ? '#ef4444' : (stateTypeColors[s.type] ?? '#6b7280');
              }
              return s ? (stateTypeColors[s.type] ?? '#4b5563') : '#4b5563';
            }}
            nodeStrokeColor="#9ca3af"
            nodeStrokeWidth={3}
            maskColor="rgba(0, 0, 0, 0.4)"
            style={{ backgroundColor: '#1f2937', width: 200, height: 150 }}
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
      <GraphLegend />
    </div>
  );
}

export function WorkflowGraph({
  workflow,
  stateEnteredAt,
  compact,
  preview,
  visible,
  roleAssignments,
}: Readonly<WorkflowGraphProps>) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphInner
        workflow={workflow}
        stateEnteredAt={stateEnteredAt}
        compact={compact}
        preview={preview}
        visible={visible}
        roleAssignments={roleAssignments}
      />
    </ReactFlowProvider>
  );
}
