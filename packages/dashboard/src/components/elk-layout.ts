import type { WorkflowStateView } from '@ai-dev-orchestrator/schemas';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

import { deriveSpine } from './workflow-graph-layout';

let elkInstance: Awaited<ReturnType<typeof loadElk>> | null = null;

async function loadElk() {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  return new ELK();
}

async function getElk() {
  elkInstance ??= await loadElk();
  return elkInstance;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const SUB_NODE_GAP = 16;
const GROUP_H_PAD = 10;
const GROUP_TOP_PAD = 24;
const GROUP_BOTTOM_PAD = 8;
const MAX_ELK_PARALLEL_SLOTS = 3;
const HUB_STATE_TYPES = new Set(['wait', 'terminal']);
export const MARKER_WIDTH = 50;
export const MARKER_HEIGHT = 50;

const HAPPY_TRIGGERS = [
  'completion',
  'completed',
  'human_approved',
  'review_approved',
  'judge_approved',
];

function isHappyTrigger(trigger: string): boolean {
  return HAPPY_TRIGGERS.some((h) => trigger.includes(h));
}

export async function computeElkPositions(
  workflow: WorkflowStateView,
): Promise<ReadonlyMap<string, { x: number; y: number }>> {
  const spine = deriveSpine(workflow);
  const adj = new Map<string, Set<string>>();
  for (const t of workflow.transitions) {
    if (!adj.has(t.from)) {
      adj.set(t.from, new Set());
    }
    adj.get(t.from)?.add(t.to);
  }

  const partitions = new Map<string, number>();
  let partitionIdx = 0;
  for (let i = 0; i < spine.length; i++) {
    const id = spine[i];
    const isDirectSuccessor = i === 0 || adj.get(spine[i - 1])?.has(id);
    if (isDirectSuccessor) {
      partitions.set(id, partitionIdx);
      partitionIdx++;
    } else {
      const connected: number[] = [];
      for (const t of workflow.transitions) {
        if (t.from === id && partitions.has(t.to)) {
          connected.push(partitions.get(t.to) ?? 0);
        }
        if (t.to === id && partitions.has(t.from)) {
          connected.push(partitions.get(t.from) ?? 0);
        }
      }
      if (connected.length > 0) {
        connected.sort((a, b) => a - b);
        partitions.set(id, connected[Math.floor(connected.length / 2)]);
      } else {
        partitions.set(id, partitionIdx++);
      }
    }
  }
  const lastPartition = partitionIdx;
  for (const s of workflow.states) {
    if (!partitions.has(s.id)) {
      partitions.set(s.id, lastPartition);
    }
  }

  const children: ElkNode[] = workflow.states.map((s) => {
    const parallelCount = s.parallelInfo?.parallelRoles?.length ?? 0;
    const hasDynamicRole = !!s.parallelInfo?.dynamicRole;
    const dynamicCount = s.parallelInfo?.dynamicWorkerCount ?? (hasDynamicRole ? 2 : 0);
    const dynamicUnknown = hasDynamicRole && s.parallelInfo?.dynamicWorkerCount === undefined;
    const effectiveCount = parallelCount > 1 ? parallelCount : dynamicCount;
    const cappedCount = Math.min(effectiveCount, MAX_ELK_PARALLEL_SLOTS);
    const hasOverflow = effectiveCount > MAX_ELK_PARALLEL_SLOTS || dynamicUnknown;
    const totalSlots = cappedCount + (hasOverflow ? 1 : 0);
    const width =
      totalSlots > 1
        ? totalSlots * NODE_WIDTH + (totalSlots - 1) * SUB_NODE_GAP + 2 * GROUP_H_PAD
        : NODE_WIDTH;
    const height = totalSlots > 1 ? NODE_HEIGHT + GROUP_TOP_PAD + GROUP_BOTTOM_PAD : NODE_HEIGHT;
    return {
      id: s.id,
      width,
      height,
      layoutOptions: {
        'elk.partitioning.partition': String(partitions.get(s.id) ?? lastPartition),
      },
    };
  });

  const hubIds = new Set(
    workflow.states.filter((s) => HUB_STATE_TYPES.has(s.type)).map((s) => s.id),
  );

  const seen = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  let idx = 0;
  for (const t of workflow.transitions) {
    if (t.from === t.to) {
      continue;
    }
    const key = `${t.from}->${t.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const involvesHub = hubIds.has(t.from) || hubIds.has(t.to);
    edges.push({
      id: `elk-e-${String(idx++)}`,
      sources: [t.from],
      targets: [t.to],
      layoutOptions: {
        'org.eclipse.elk.priority': involvesHub ? '1' : isHappyTrigger(t.trigger) ? '10' : '1',
      },
    });
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.partitioning.activate': 'true',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.nodeNode': '50',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
      'elk.layered.thoroughness': '20',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'elk.layered.mergeEdges': 'true',
      'elk.separateConnectedComponents': 'false',
    },
    children,
    edges,
  };

  const elk = await getElk();
  const result = await elk.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of result.children ?? []) {
    positions.set(node.id, {
      x: (node.x ?? 0) + (node.width ?? NODE_WIDTH) / 2,
      y: (node.y ?? 0) + (node.height ?? NODE_HEIGHT) / 2,
    });
  }

  const MARKER_GAP = 80;
  const incoming = new Set(workflow.transitions.map((t) => t.to));
  const initialId =
    workflow.states.find((s) => !incoming.has(s.id) && s.type !== 'terminal')?.id ??
    workflow.states[0]?.id;
  const initialPos = initialId ? positions.get(initialId) : undefined;
  if (initialPos) {
    positions.set('__START__', { x: initialPos.x, y: initialPos.y - MARKER_GAP });
  }

  const terminalIds = workflow.states.filter((s) => s.type === 'terminal').map((s) => s.id);
  const terminalPositions = terminalIds
    .map((id) => positions.get(id))
    .filter((p): p is { x: number; y: number } => p !== undefined);
  if (terminalPositions.length > 0) {
    const avgX = terminalPositions.reduce((sum, p) => sum + p.x, 0) / terminalPositions.length;
    const maxY = Math.max(...terminalPositions.map((p) => p.y));
    positions.set('__END__', { x: avgX, y: maxY + MARKER_GAP });
  }

  return positions;
}
