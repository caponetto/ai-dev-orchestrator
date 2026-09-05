import type { StateNode } from '@ai-dev-orchestrator/schemas';
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  annotateHandleVisibility,
  buildNodeStyle,
  buildStyledEdges,
  createDynamicParallelSubNodes,
  createParallelSubNodes,
  expandTransitionsToRawEdges,
  type RawEdge,
} from '../workflow-graph-builders';

describe('expandTransitionsToRawEdges', () => {
  const spine = ['A', 'B', 'C'];
  const order = new Map([
    ['A', 0],
    ['B', 1],
    ['C', 2],
  ]);
  const noParallel = new Map<string, string[]>();

  it('filters out self-loop transitions', () => {
    const transitions = [
      { from: 'A', to: 'A', trigger: 'retry', traversed: true, traversalCount: 1 },
      { from: 'A', to: 'B', trigger: 'completion', traversed: true, traversalCount: 1 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spine,
      order,
      noParallel,
      'B',
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('A');
    expect(result[0].target).toBe('B');
  });

  it('hides untraversed non-forward edges when not both on spine', () => {
    const spineAB = ['A', 'B'];
    const orderABX = new Map([
      ['A', 0],
      ['B', 1],
      ['X', 2],
    ]);
    const transitions = [
      { from: 'X', to: 'A', trigger: 'retry', traversed: false, traversalCount: 0 },
      { from: 'A', to: 'B', trigger: 'completion', traversed: true, traversalCount: 1 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spineAB,
      orderABX,
      noParallel,
      'B',
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('A');
  });

  it('keeps untraversed backward edges when both ends are on spine', () => {
    const transitions = [
      { from: 'C', to: 'A', trigger: 'retry', traversed: false, traversalCount: 0 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spine,
      order,
      noParallel,
      undefined,
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('C');
    expect(result[0].target).toBe('A');
  });

  it('expands through parallelSubIds for source', () => {
    const parallelSubs = new Map([['A', ['A__role1', 'A__role2']]]);
    const transitions = [
      { from: 'A', to: 'B', trigger: 'completion', traversed: true, traversalCount: 1 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spine,
      order,
      parallelSubs,
      'B',
      undefined,
    );
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('A__role1');
    expect(result[1].source).toBe('A__role2');
    expect(result[0].target).toBe('B');
    expect(result[1].target).toBe('B');
  });

  it('expands through parallelSubIds for both source and target', () => {
    const parallelSubs = new Map([
      ['A', ['A__r1', 'A__r2']],
      ['B', ['B__r1', 'B__r2']],
    ]);
    const transitions = [
      { from: 'A', to: 'B', trigger: 'completion', traversed: true, traversalCount: 1 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spine,
      order,
      parallelSubs,
      'C',
      undefined,
    );
    expect(result).toHaveLength(4);
  });

  it('includes abort edge from predecessor even if untraversed', () => {
    const spineWithAbort = ['A', 'B', 'C'];
    const orderWithAbort = new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['ABORTED', 3],
    ]);
    const transitions = [
      { from: 'B', to: 'ABORTED', trigger: 'abort', traversed: false, traversalCount: 0 },
    ];
    const result = expandTransitionsToRawEdges(
      transitions,
      spineWithAbort,
      orderWithAbort,
      noParallel,
      'ABORTED',
      'B',
    );
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe('ABORTED');
  });
});

describe('buildStyledEdges', () => {
  const order = new Map([
    ['A', 0],
    ['B', 1],
    ['C', 2],
  ]);

  it('styles traversed forward edges with blue stroke and width 2', () => {
    const rawEdges: RawEdge[] = [
      {
        source: 'A',
        target: 'B',
        t: { from: 'A', to: 'B', trigger: 'completion', traversed: true, traversalCount: 1 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, order, undefined, false, undefined);
    expect(edges).toHaveLength(1);
    expect(edges[0].style?.stroke).toBe('#60a5fa');
    expect(edges[0].style?.strokeWidth).toBe(2.5);
  });

  it('styles untraversed forward edges with gray stroke and dashed pattern', () => {
    const rawEdges: RawEdge[] = [
      {
        source: 'A',
        target: 'B',
        t: { from: 'A', to: 'B', trigger: 'completion', traversed: false, traversalCount: 0 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, order, undefined, false, undefined);
    expect(edges[0].style?.stroke).toBe('#9ca3af');
    expect(edges[0].style?.strokeWidth).toBe(1.5);
    expect(edges[0].style?.strokeDasharray).toBe('4 4');
  });

  it('removes dash pattern when terminal is true', () => {
    const rawEdges: RawEdge[] = [
      {
        source: 'A',
        target: 'B',
        t: { from: 'A', to: 'B', trigger: 'completion', traversed: false, traversalCount: 0 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, order, undefined, true, undefined);
    expect(edges[0].style?.strokeDasharray).toBeUndefined();
  });

  it('uses left handles for backward edges', () => {
    const rawEdges: RawEdge[] = [
      {
        source: 'C',
        target: 'A',
        t: { from: 'C', to: 'A', trigger: 'retry', traversed: true, traversalCount: 1 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, order, undefined, false, undefined);
    expect(edges[0].sourceHandle).toBe('left-out');
    expect(edges[0].targetHandle).toBe('left-in');
  });

  it('uses right handles for edges that skip spine nodes', () => {
    const rawEdges: RawEdge[] = [
      {
        source: 'A',
        target: 'C',
        t: { from: 'A', to: 'C', trigger: 'completion', traversed: true, traversalCount: 1 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, order, undefined, false, undefined);
    expect(edges[0].sourceHandle).toBe('right-out');
    expect(edges[0].targetHandle).toBe('right-in');
  });

  it('marks abort edge as traversed when from abortPredecessor', () => {
    const orderWithAbort = new Map([
      ['A', 0],
      ['B', 1],
      ['ABORTED', 2],
    ]);
    const rawEdges: RawEdge[] = [
      {
        source: 'B',
        target: 'ABORTED',
        t: { from: 'B', to: 'ABORTED', trigger: 'abort', traversed: false, traversalCount: 0 },
        idx: 0,
      },
    ];
    const edges = buildStyledEdges(rawEdges, orderWithAbort, 'B', false, undefined);
    expect(edges[0].style?.stroke).toBe('#ef4444');
    expect(edges[0].style?.strokeWidth).toBe(2.5);
  });
});

describe('buildNodeStyle', () => {
  const baseOpts = {
    background: '#1f2937',
    borderColor: '#374151',
    isTerminal: false,
    fontWeight: 500,
    preview: undefined as boolean | undefined,
    opacity: 1,
    width: 200,
    height: 60,
    current: false,
  };

  it('assembles basic style properties', () => {
    const style = buildNodeStyle(baseOpts);
    expect(style.background).toBe('#1f2937');
    expect(style.border).toBe('2px solid #374151');
    expect(style.borderRadius).toBe(8);
    expect(style.fontWeight).toBe(500);
    expect(style.width).toBe(200);
    expect(style.height).toBe(60);
    expect(style.display).toBe('flex');
    expect(style.alignItems).toBe('center');
    expect(style.justifyContent).toBe('center');
  });

  it('uses borderRadius 16 for terminal nodes', () => {
    const style = buildNodeStyle({ ...baseOpts, isTerminal: true });
    expect(style.borderRadius).toBe(16);
  });

  it('applies box shadow when current is true', () => {
    const style = buildNodeStyle({ ...baseOpts, current: true });
    expect(style.boxShadow).toBe('0 0 0 3px rgba(147, 197, 253, 0.35)');
  });

  it('does not apply box shadow when current is false', () => {
    const style = buildNodeStyle(baseOpts);
    expect(style.boxShadow).toBeUndefined();
  });

  it('uses preview text color when preview is set', () => {
    const style = buildNodeStyle({ ...baseOpts, preview: true });
    expect(style.color).toBe('#e2e8f0');
  });

  it('uses default text color when preview is undefined', () => {
    const style = buildNodeStyle(baseOpts);
    expect(style.color).toBe('#f9fafb');
  });
});

describe('annotateHandleVisibility', () => {
  it('adds hide-handle-bottom when node is not a source', () => {
    const nodes: Node[] = [
      { id: 'A', position: { x: 0, y: 0 }, data: {} },
      { id: 'B', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [{ id: 'e-0', source: 'A', target: 'B' }];
    annotateHandleVisibility(nodes, edges);
    expect(nodes[1].className).toContain('hide-handle-bottom');
    expect(nodes[0].className).not.toContain('hide-handle-bottom');
  });

  it('adds hide-handle-top when node is not a target', () => {
    const nodes: Node[] = [
      { id: 'A', position: { x: 0, y: 0 }, data: {} },
      { id: 'B', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [{ id: 'e-0', source: 'A', target: 'B' }];
    annotateHandleVisibility(nodes, edges);
    expect(nodes[0].className).toContain('hide-handle-top');
    expect(nodes[1].className).not.toContain('hide-handle-top');
  });

  it('preserves existing className', () => {
    const nodes: Node[] = [
      { id: 'A', position: { x: 0, y: 0 }, data: {}, className: 'state-pulse' },
    ];
    const edges: Edge[] = [];
    annotateHandleVisibility(nodes, edges);
    expect(nodes[0].className).toContain('state-pulse');
    expect(nodes[0].className).toContain('hide-handle-bottom');
    expect(nodes[0].className).toContain('hide-handle-top');
  });

  it('does not add classes for nodes that are both source and target', () => {
    const nodes: Node[] = [{ id: 'A', position: { x: 0, y: 0 }, data: {} }];
    const edges: Edge[] = [{ id: 'e-0', source: 'A', target: 'A' }];
    annotateHandleVisibility(nodes, edges);
    expect(nodes[0].className).toBeUndefined();
  });
});

describe('createParallelSubNodes', () => {
  const baseState: StateNode = {
    id: 'REVIEW',
    type: 'review',
    label: 'Code Review',
    visited: false,
    current: true,
    timeSpentMs: 0,
    visitCount: 1,
    parallelInfo: {
      type: 'fork',
      parallelRoles: ['static_reviewer', 'design_reviewer'],
    },
  };

  it('creates a group node plus sub-nodes', () => {
    const { nodes } = createParallelSubNodes(
      baseState,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe('parallelGroup');
    expect(nodes[1].parentId).toBe(nodes[0].id);
    expect(nodes[2].parentId).toBe(nodes[0].id);
  });

  it('pulses all sub-nodes when no roles are done', () => {
    const { nodes } = createParallelSubNodes(
      baseState,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBe('state-pulse');
    expect(subs[1].className).toBe('state-pulse');
  });

  it('stops pulsing a sub-node when its role has a positive duration', () => {
    const stateWithOneDone: StateNode = {
      ...baseState,
      parallelInfo: {
        type: 'fork',
        parallelRoles: ['static_reviewer', 'design_reviewer'],
        roleDurations: { static_reviewer: 12000 },
      },
    };
    const { nodes } = createParallelSubNodes(
      stateWithOneDone,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBeUndefined();
    expect(subs[1].className).toBe('state-pulse');
  });

  it('stops pulsing all sub-nodes when all roles are done', () => {
    const stateAllDone: StateNode = {
      ...baseState,
      parallelInfo: {
        type: 'fork',
        parallelRoles: ['static_reviewer', 'design_reviewer'],
        roleDurations: { static_reviewer: 12000, design_reviewer: 8000 },
      },
    };
    const { nodes } = createParallelSubNodes(
      stateAllDone,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBeUndefined();
    expect(subs[1].className).toBeUndefined();
  });

  it('uses visited border color for completed sub-nodes', () => {
    const stateWithOneDone: StateNode = {
      ...baseState,
      parallelInfo: {
        type: 'fork',
        parallelRoles: ['static_reviewer', 'design_reviewer'],
        roleDurations: { static_reviewer: 5000 },
      },
    };
    const { nodes } = createParallelSubNodes(
      stateWithOneDone,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    const doneStyle = subs[0].style as Record<string, unknown>;
    const activeStyle = subs[1].style as Record<string, unknown>;
    expect(doneStyle['boxShadow']).toBeUndefined();
    expect(activeStyle['boxShadow']).toBe('0 0 0 3px rgba(147, 197, 253, 0.35)');
  });

  it('does not pulse any sub-node when state is not current', () => {
    const notCurrent: StateNode = {
      ...baseState,
      current: false,
      visited: true,
    };
    const { nodes } = createParallelSubNodes(
      notCurrent,
      ['static_reviewer', 'design_reviewer'],
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBeUndefined();
    expect(subs[1].className).toBeUndefined();
  });
});

describe('createDynamicParallelSubNodes', () => {
  const baseState: StateNode = {
    id: 'SPEC_AUTHORING',
    type: 'action',
    label: 'Spec Authoring',
    visited: false,
    current: true,
    timeSpentMs: 0,
    visitCount: 1,
    parallelInfo: {
      type: 'fork',
      dynamicRole: 'task_spec_writer',
      dynamicWorkerCount: 4,
    },
  };

  it('creates a group node plus numbered sub-nodes', () => {
    const { nodes, subIds } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      4,
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    expect(nodes).toHaveLength(5);
    expect(nodes[0].type).toBe('parallelGroup');
    expect(subIds).toHaveLength(4);
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs).toHaveLength(4);
    expect(subs[0].data.label).toBe('Task Spec Writer #1');
    expect(subs[1].data.label).toBe('Task Spec Writer #2');
    expect(subs[2].data.label).toBe('Task Spec Writer #3');
    expect(subs[3].data.label).toBe('Task Spec Writer #4');
  });

  it('caps visible nodes at 5 with overflow indicator for count > 5', () => {
    const { nodes, subIds } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      8,
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs).toHaveLength(6);
    expect(subIds).toHaveLength(6);
    expect(subs[5].data.label).toBe('+3 more');
    const overflowStyle = subs[5].style as Record<string, unknown>;
    expect(overflowStyle['borderStyle']).toBe('dashed');
  });

  it('does not add overflow indicator when count <= 5', () => {
    const { nodes } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      3,
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs).toHaveLength(3);
    expect(subs.every((n) => !(n.data.label as string).includes('more'))).toBe(true);
  });

  it('pulses all sub-nodes when state is current', () => {
    const { nodes } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      2,
      { x: 0, y: 0 },
      'main',
      false,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBe('state-pulse');
    expect(subs[1].className).toBe('state-pulse');
  });

  it('does not pulse sub-nodes in preview mode', () => {
    const { nodes } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      2,
      { x: 0, y: 0 },
      'main',
      true,
      undefined,
      undefined,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs[0].className).toBeUndefined();
    expect(subs[1].className).toBeUndefined();
  });

  it('shows "..." indicator when unknownCount is true', () => {
    const { nodes, subIds } = createDynamicParallelSubNodes(
      baseState,
      'task_spec_writer',
      2,
      { x: 0, y: 0 },
      'main',
      true,
      undefined,
      undefined,
      true,
    );
    const subs = nodes.filter((n) => n.type === 'multiHandle');
    expect(subs).toHaveLength(3);
    expect(subIds).toHaveLength(3);
    expect(subs[0].data.label).toBe('Task Spec Writer #1');
    expect(subs[1].data.label).toBe('Task Spec Writer #2');
    expect(subs[2].data.label).toBe('...');
    const overflowStyle = subs[2].style as Record<string, unknown>;
    expect(overflowStyle['borderStyle']).toBe('dashed');
  });
});
