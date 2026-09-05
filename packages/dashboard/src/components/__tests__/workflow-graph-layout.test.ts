import type { StateNode, TransitionEdge, WorkflowStateView } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  categorizeEdge,
  classifyStates,
  computeProgress,
  deriveSpine,
  humanizeStateLabel,
  shouldShowEdgeLabel,
  spineOrder,
  stateTypeIcon,
  COLUMN_OFFSET_PX,
  layoutPositions,
} from '../workflow-graph-layout';

function state(id: string, type = 'action'): StateNode {
  return {
    id,
    type,
    label: id,
    visited: false,
    current: false,
    timeSpentMs: 0,
    visitCount: 0,
  };
}

function edge(
  from: string,
  to: string,
  trigger: string,
  traversed = false,
  traversalCount = 0,
): TransitionEdge {
  return { from, to, trigger, traversed, traversalCount };
}

function buildWorkflow(overrides: Partial<WorkflowStateView> = {}): WorkflowStateView {
  return {
    runId: 'run-1',
    currentState: 'INTAKE',
    visitedStates: ['INTAKE'],
    stateHistory: ['INTAKE'],
    states: [],
    transitions: [],
    ...overrides,
  };
}

const fullWorkflow: WorkflowStateView = {
  runId: 'run-1',
  currentState: 'INTAKE',
  visitedStates: ['INTAKE'],
  stateHistory: ['INTAKE'],
  states: [
    state('INTAKE'),
    state('REFINEMENT'),
    state('WAITING_FOR_HUMAN', 'wait'),
    state('PLANNING'),
    state('PLAN_REVIEW', 'review'),
    state('IMPLEMENTATION'),
    state('CODE_REVIEW', 'review'),
    state('JUDGE_REVIEW', 'judge'),
    state('VERIFICATION'),
    state('WRAP_UP'),
    state('DONE', 'terminal'),
    state('ABORTED', 'terminal'),
  ],
  transitions: [
    edge('INTAKE', 'REFINEMENT', 'completion'),
    edge('REFINEMENT', 'PLANNING', 'completion'),
    edge('PLANNING', 'PLAN_REVIEW', 'completion'),
    edge('PLAN_REVIEW', 'WAITING_FOR_HUMAN', 'review_approved'),
    edge('PLAN_REVIEW', 'PLANNING', 'review_rejected'),
    edge('WAITING_FOR_HUMAN', 'IMPLEMENTATION', 'human_approved'),
    edge('WAITING_FOR_HUMAN', 'REFINEMENT', 'human_rejected'),
    edge('IMPLEMENTATION', 'CODE_REVIEW', 'completion'),
    edge('CODE_REVIEW', 'IMPLEMENTATION', 'review_rejected'),
    edge('CODE_REVIEW', 'JUDGE_REVIEW', 'iteration_exhausted'),
    edge('JUDGE_REVIEW', 'VERIFICATION', 'judge_approved'),
    edge('JUDGE_REVIEW', 'IMPLEMENTATION', 'judge_rejected'),
    edge('VERIFICATION', 'WRAP_UP', 'completion'),
    edge('WRAP_UP', 'DONE', 'completion'),
    edge('CODE_REVIEW', 'ABORTED', 'failure'),
  ],
};

describe('deriveSpine', () => {
  it('derives spine from workflow transitions following happy-path triggers', () => {
    const spine = deriveSpine(fullWorkflow);
    expect(spine[0]).toBe('INTAKE');
    expect(spine[1]).toBe('REFINEMENT');
    expect(spine).toContain('PLANNING');
    expect(spine).toContain('IMPLEMENTATION');
    expect(spine[spine.length - 1]).toBe('DONE');
  });

  it('keeps WAITING_FOR_HUMAN on spine when reachable via happy path', () => {
    const spine = deriveSpine(fullWorkflow);
    expect(spine).toContain('WAITING_FOR_HUMAN');
    const reqIdx = spine.indexOf('REFINEMENT');
    const waitIdx = spine.indexOf('WAITING_FOR_HUMAN');
    expect(waitIdx).toBeGreaterThan(reqIdx);
  });

  it('places states without happy-path edges off-spine', () => {
    const spine = deriveSpine(fullWorkflow);
    expect(spine).not.toContain('ABORTED');
  });

  it('returns empty array for empty workflow', () => {
    const empty = buildWorkflow();
    const spine = deriveSpine(empty);
    expect(spine).toEqual([]);
  });

  it('appends DONE when not reachable via DFS but present in states', () => {
    const disconnected = buildWorkflow({
      states: [state('STEP_A'), state('STEP_B'), state('DONE', 'terminal')],
      transitions: [edge('STEP_A', 'STEP_B', 'completion')],
    });
    const spine = deriveSpine(disconnected);
    expect(spine).toContain('STEP_A');
    expect(spine).toContain('STEP_B');
    expect(spine[spine.length - 1]).toBe('DONE');
  });

  it('does not duplicate DONE when it is already on the spine', () => {
    const connected = buildWorkflow({
      states: [state('STEP_A'), state('DONE', 'terminal')],
      transitions: [edge('STEP_A', 'DONE', 'completion')],
    });
    const spine = deriveSpine(connected);
    const doneCount = spine.filter((s) => s === 'DONE').length;
    expect(doneCount).toBe(1);
  });

  it('resumes DFS from a backtracked spine state when stuck', () => {
    // A -> B -> C (stuck), but A -> D exists as alternate
    const workflow = buildWorkflow({
      states: [state('A'), state('B'), state('C'), state('D')],
      transitions: [
        edge('A', 'B', 'completion'),
        edge('B', 'C', 'completion'),
        // D is reachable from A but not from C — DFS should backtrack to A
        edge('A', 'D', 'other'),
      ],
    });
    const spine = deriveSpine(workflow);
    expect(spine).toContain('A');
    expect(spine).toContain('B');
    expect(spine).toContain('C');
    expect(spine).toContain('D');
  });

  it('picks initial state as the one with no incoming edges', () => {
    const workflow = buildWorkflow({
      states: [state('MIDDLE'), state('START'), state('END')],
      transitions: [edge('START', 'MIDDLE', 'completion'), edge('MIDDLE', 'END', 'completion')],
    });
    const spine = deriveSpine(workflow);
    expect(spine[0]).toBe('START');
  });

  it('falls back to first state if all states have incoming edges', () => {
    // Circular: every state has an incoming edge
    const workflow = buildWorkflow({
      states: [state('A'), state('B')],
      transitions: [edge('A', 'B', 'completion'), edge('B', 'A', 'loop')],
    });
    const spine = deriveSpine(workflow);
    expect(spine[0]).toBe('A');
  });

  it('prefers completion trigger over other triggers', () => {
    const workflow = buildWorkflow({
      states: [state('ROOT'), state('SIDE'), state('MAIN')],
      transitions: [edge('ROOT', 'SIDE', 'failure'), edge('ROOT', 'MAIN', 'completion')],
    });
    const spine = deriveSpine(workflow);
    const mainIdx = spine.indexOf('MAIN');
    const sideIdx = spine.indexOf('SIDE');
    // MAIN should come before SIDE on the spine because completion is preferred
    expect(mainIdx).toBeLessThan(sideIdx);
  });
});

describe('classifyStates', () => {
  it('places the canonical spine in the main column', () => {
    const classified = classifyStates(fullWorkflow);
    expect(classified.get('INTAKE')?.column).toBe(0);
    expect(classified.get('REFINEMENT')?.column).toBe(0);
    expect(classified.get('PLANNING')?.column).toBe(0);
    expect(classified.get('PLAN_REVIEW')?.column).toBe(0);
    expect(classified.get('IMPLEMENTATION')?.column).toBe(0);
    expect(classified.get('CODE_REVIEW')?.column).toBe(0);
    expect(classified.get('VERIFICATION')?.column).toBe(0);
    expect(classified.get('WRAP_UP')?.column).toBe(0);
    expect(classified.get('DONE')?.column).toBe(0);
  });

  it('places WAITING_FOR_HUMAN on the spine', () => {
    const classified = classifyStates(fullWorkflow);
    expect(classified.get('WAITING_FOR_HUMAN')?.column).toBe(0);
    expect(classified.get('WAITING_FOR_HUMAN')?.role).toBe('main');
  });

  it('places JUDGE_REVIEW on the spine when it is the only forward path from CODE_REVIEW', () => {
    const classified = classifyStates(fullWorkflow);
    expect(classified.get('JUDGE_REVIEW')?.column).toBe(0);
    expect(classified.get('JUDGE_REVIEW')?.role).toBe('main');
  });

  it('places ABORTED on the opposite side as a terminal branch', () => {
    const classified = classifyStates(fullWorkflow);
    expect(classified.get('ABORTED')?.column).toBe(1);
    expect(classified.get('ABORTED')?.role).toBe('terminal-branch');
  });

  it('exposes a stable pixel offset per column', () => {
    expect(COLUMN_OFFSET_PX).toBeGreaterThan(0);
  });

  it('classifies non-terminal off-spine states as branch in column -1', () => {
    // ORPHAN has no transitions connecting it to spine states, so it stays off-spine.
    // Its only transition is FROM itself TO a spine state, which the DFS resume
    // mechanism cannot discover (resume only follows outgoing edges FROM spine states).
    const workflow = buildWorkflow({
      states: [state('START'), state('MAIN_PATH'), state('ORPHAN'), state('DONE', 'terminal')],
      transitions: [
        edge('START', 'MAIN_PATH', 'completion'),
        edge('MAIN_PATH', 'DONE', 'completion'),
        edge('ORPHAN', 'MAIN_PATH', 'rejoin'),
      ],
    });
    const classified = classifyStates(workflow);
    expect(classified.get('ORPHAN')?.role).toBe('branch');
    expect(classified.get('ORPHAN')?.column).toBe(-1);
  });

  it('classifies non-DONE terminal states as terminal-branch', () => {
    const workflow = buildWorkflow({
      states: [
        state('START'),
        state('DONE', 'terminal'),
        state('FAILED', 'terminal'),
        state('CANCELLED', 'terminal'),
      ],
      transitions: [
        edge('START', 'DONE', 'completion'),
        edge('START', 'FAILED', 'failure'),
        edge('START', 'CANCELLED', 'cancel'),
      ],
    });
    const classified = classifyStates(workflow);
    expect(classified.get('FAILED')?.role).toBe('terminal-branch');
    expect(classified.get('FAILED')?.column).toBe(1);
    expect(classified.get('CANCELLED')?.role).toBe('terminal-branch');
    expect(classified.get('CANCELLED')?.column).toBe(1);
  });

  it('assigns spineIndex to main states only', () => {
    const classified = classifyStates(fullWorkflow);
    expect(classified.get('INTAKE')?.spineIndex).toBe(0);
    expect(classified.get('ABORTED')?.spineIndex).toBeUndefined();
  });
});

describe('spineOrder', () => {
  it('returns spine indices for spine states and appends non-spine states after', () => {
    const order = spineOrder(fullWorkflow);
    const intakeOrder = order.get('INTAKE');
    const abortedOrder = order.get('ABORTED');
    expect(intakeOrder).toBeDefined();
    expect(abortedOrder).toBeDefined();
    expect(intakeOrder).toBeLessThan(abortedOrder as number);
  });

  it('includes all states from the workflow', () => {
    const order = spineOrder(fullWorkflow);
    for (const s of fullWorkflow.states) {
      expect(order.has(s.id)).toBe(true);
    }
  });
});

describe('categorizeEdge', () => {
  const order = spineOrder(fullWorkflow);

  it('marks reverse-order transitions as backward', () => {
    expect(categorizeEdge(edge('CODE_REVIEW', 'IMPLEMENTATION', 'review_rejected'), order)).toBe(
      'backward',
    );
  });

  it('marks transitions into ABORTED as abort', () => {
    expect(categorizeEdge(edge('CODE_REVIEW', 'ABORTED', 'failure'), order)).toBe('abort');
  });

  it('marks forward main-path transitions as forward', () => {
    expect(categorizeEdge(edge('IMPLEMENTATION', 'CODE_REVIEW', 'completion'), order)).toBe(
      'forward',
    );
  });

  it('marks transitions into DONE as forward regardless of order', () => {
    expect(categorizeEdge(edge('WRAP_UP', 'DONE', 'completion'), order)).toBe('forward');
  });

  it('marks transitions as forward when from state is not in the order map', () => {
    expect(categorizeEdge(edge('UNKNOWN_FROM', 'INTAKE', 'trigger'), order)).toBe('forward');
  });

  it('marks transitions as forward when to state is not in the order map', () => {
    expect(categorizeEdge(edge('INTAKE', 'UNKNOWN_TO', 'trigger'), order)).toBe('forward');
  });

  it('treats backward transition from a later to an earlier spine state', () => {
    expect(categorizeEdge(edge('JUDGE_REVIEW', 'IMPLEMENTATION', 'judge_rejected'), order)).toBe(
      'backward',
    );
  });
});

describe('shouldShowEdgeLabel', () => {
  it('shows labels for traversed edges', () => {
    expect(
      shouldShowEdgeLabel(edge('INTAKE', 'REFINEMENT', 'completion', true, 1), 'forward'),
    ).toBe(true);
  });

  it('hides labels for untraversed edges regardless of category', () => {
    expect(
      shouldShowEdgeLabel(edge('CODE_REVIEW', 'IMPLEMENTATION', 'review_rejected'), 'backward'),
    ).toBe(false);
    expect(shouldShowEdgeLabel(edge('CODE_REVIEW', 'ABORTED', 'failure'), 'abort')).toBe(false);
    expect(
      shouldShowEdgeLabel(edge('IMPLEMENTATION', 'CODE_REVIEW', 'completion', false, 0), 'forward'),
    ).toBe(false);
  });

  it('shows labels for traversed backward edges', () => {
    expect(
      shouldShowEdgeLabel(
        edge('CODE_REVIEW', 'IMPLEMENTATION', 'review_rejected', true, 2),
        'backward',
      ),
    ).toBe(true);
  });

  it('shows labels for traversed abort edges', () => {
    expect(shouldShowEdgeLabel(edge('CODE_REVIEW', 'ABORTED', 'failure', true, 1), 'abort')).toBe(
      true,
    );
  });
});

describe('humanizeStateLabel', () => {
  it('title-cases state IDs', () => {
    expect(humanizeStateLabel('CODE_REVIEW')).toBe('Code Review');
    expect(humanizeStateLabel('WAITING_FOR_HUMAN')).toBe('Waiting For Human');
    expect(humanizeStateLabel('DONE')).toBe('Done');
    expect(humanizeStateLabel('CUSTOM_STEP')).toBe('Custom Step');
  });

  it('handles single-word state IDs', () => {
    expect(humanizeStateLabel('INTAKE')).toBe('Intake');
  });

  it('handles lowercase input by keeping first char as-is and lowering the rest', () => {
    // Splits on '_', title-cases each word: first char kept, rest lowered
    expect(humanizeStateLabel('some_state')).toBe('some state');
    expect(humanizeStateLabel('HELLO')).toBe('Hello');
  });

  it('handles empty string', () => {
    expect(humanizeStateLabel('')).toBe('');
  });
});

describe('stateTypeIcon', () => {
  it('returns an icon for known types', () => {
    expect(stateTypeIcon('action')).toBe('▶');
    expect(stateTypeIcon('review')).toBe('◉');
    expect(stateTypeIcon('judge')).toBe('⚖');
    expect(stateTypeIcon('wait')).toBe('⏳');
    expect(stateTypeIcon('terminal')).toBe('⬤');
  });

  it('returns icons for gate and script types', () => {
    expect(stateTypeIcon('gate')).toBe('⚠');
    expect(stateTypeIcon('script')).toBe('⚙');
  });

  it('returns a default dot for unknown types', () => {
    expect(stateTypeIcon('unknown')).toBe('●');
    expect(stateTypeIcon('custom')).toBe('●');
    expect(stateTypeIcon('')).toBe('●');
  });
});

describe('computeProgress', () => {
  it('reports step 1 of N when on the first state', () => {
    const p = computeProgress(fullWorkflow);
    expect(p.currentStep).toBe(1);
    expect(p.totalSteps).toBe(deriveSpine(fullWorkflow).length);
    expect(p.percent).toBeGreaterThan(0);
    expect(p.isComplete).toBe(false);
  });

  it('reports 100% complete when current state is terminal', () => {
    const done: WorkflowStateView = {
      ...fullWorkflow,
      currentState: 'DONE',
      states: fullWorkflow.states.map((s) =>
        s.id === 'DONE' ? { ...s, current: true, visited: true } : { ...s, current: false },
      ),
    };
    const p = computeProgress(done);
    expect(p.percent).toBe(100);
    expect(p.isComplete).toBe(true);
  });

  it('reports correct step when current state is WAITING_FOR_HUMAN (on spine)', () => {
    const waiting: WorkflowStateView = {
      ...fullWorkflow,
      currentState: 'WAITING_FOR_HUMAN',
    };
    const p = computeProgress(waiting);
    expect(p.currentStep).toBe(5);
    expect(p.percent).toBeGreaterThan(0);
  });

  it('falls back to latest visited spine state when current state is off-spine', () => {
    // Use a non-terminal off-spine state as currentState so the terminal check
    // does not short-circuit before the fallback logic on lines 374-381.
    // OFF_SPINE is not connected to any spine state via transitions from spine,
    // so deriveSpine will not include it.
    const workflow: WorkflowStateView = {
      ...fullWorkflow,
      currentState: 'OFF_SPINE',
      visitedStates: ['INTAKE', 'REFINEMENT', 'PLANNING', 'IMPLEMENTATION', 'CODE_REVIEW'],
      states: [...fullWorkflow.states, { ...state('OFF_SPINE'), current: true }],
    };
    const p = computeProgress(workflow);
    // OFF_SPINE is not on the spine, so it should fall back to the latest visited spine state.
    // CODE_REVIEW is the latest visited state that appears on the spine.
    const spine = deriveSpine(fullWorkflow);
    const codeReviewIdx = spine.indexOf('CODE_REVIEW');
    expect(p.currentStep).toBe(codeReviewIdx + 1);
    expect(p.isComplete).toBe(false);
    expect(p.percent).toBeGreaterThan(0);
    expect(p.percent).toBeLessThan(100);
  });

  it('reports 100% when ABORTED is current and marked as terminal', () => {
    const aborted: WorkflowStateView = {
      ...fullWorkflow,
      currentState: 'ABORTED',
      states: fullWorkflow.states.map((s) =>
        s.id === 'ABORTED' ? { ...s, current: true } : { ...s, current: false },
      ),
    };
    const p = computeProgress(aborted);
    expect(p.percent).toBe(100);
    expect(p.isComplete).toBe(true);
  });

  it('reports step 0 when current state is off-spine and no spine states visited', () => {
    const workflow = buildWorkflow({
      states: [state('A'), state('B'), state('ORPHAN'), state('DONE', 'terminal')],
      transitions: [edge('A', 'B', 'completion'), edge('B', 'DONE', 'completion')],
      currentState: 'ORPHAN',
      visitedStates: ['ORPHAN'],
    });
    const p = computeProgress(workflow);
    expect(p.currentStep).toBe(0);
    expect(p.percent).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it('reports zero steps for empty workflow', () => {
    const empty = buildWorkflow();
    const p = computeProgress(empty);
    expect(p.totalSteps).toBe(0);
    expect(p.currentStep).toBe(0);
    expect(p.percent).toBe(0);
  });
});

describe('layoutPositions', () => {
  it('keeps spine nodes on the same x but distinct y positions', () => {
    const positions = layoutPositions(fullWorkflow);
    const impl = positions.get('IMPLEMENTATION');
    const done = positions.get('DONE');
    expect(impl).toBeDefined();
    expect(done).toBeDefined();
    expect(impl?.x).toBe(done?.x);
    expect(impl?.y).not.toBe(done?.y);
    expect((done?.y ?? 0) - (impl?.y ?? 0)).toBeGreaterThan(50);
  });

  it('places WAITING_FOR_HUMAN on the spine and ABORTED to the right', () => {
    const positions = layoutPositions(fullWorkflow);
    const planning = positions.get('PLANNING');
    const waiting = positions.get('WAITING_FOR_HUMAN');
    const aborted = positions.get('ABORTED');
    expect(waiting?.x).toBe(planning?.x);
    expect(aborted?.x ?? 0).toBeGreaterThan(planning?.x ?? 0);
  });

  it('assigns spine y positions with monotonically increasing values', () => {
    const positions = layoutPositions(fullWorkflow);
    const spine = deriveSpine(fullWorkflow);
    for (let i = 1; i < spine.length; i++) {
      const prevY = positions.get(spine[i - 1])?.y ?? 0;
      const currY = positions.get(spine[i])?.y ?? 0;
      expect(currY).toBeGreaterThan(prevY);
    }
  });

  it('spaces spine nodes by SPINE_RANK_SEP_PX (160px)', () => {
    const positions = layoutPositions(fullWorkflow);
    const spine = deriveSpine(fullWorkflow);
    const y0 = positions.get(spine[0])?.y ?? 0;
    const y1 = positions.get(spine[1])?.y ?? 0;
    expect(y1 - y0).toBe(160);
  });

  it('uses default centerX of 400 for spine nodes', () => {
    const positions = layoutPositions(fullWorkflow);
    const intake = positions.get('INTAKE');
    expect(intake?.x).toBe(400);
  });

  it('respects custom centerX parameter', () => {
    const positions = layoutPositions(fullWorkflow, 600);
    const intake = positions.get('INTAKE');
    expect(intake?.x).toBe(600);
  });

  it('offsets branch columns by COLUMN_OFFSET_PX', () => {
    const positions = layoutPositions(fullWorkflow, 400);
    const aborted = positions.get('ABORTED');
    // ABORTED is in column 1 (terminal-branch)
    expect(aborted?.x).toBe(400 + COLUMN_OFFSET_PX);
  });

  it('places terminal-branch nodes at maxSpineY', () => {
    const positions = layoutPositions(fullWorkflow);
    const spine = deriveSpine(fullWorkflow);
    const lastSpineState = spine[spine.length - 1];
    const maxSpineY = positions.get(lastSpineState)?.y ?? 0;
    const aborted = positions.get('ABORTED');
    expect(aborted?.y).toBe(maxSpineY);
  });

  it('adds synthetic __START__ marker above the first spine node', () => {
    const positions = layoutPositions(fullWorkflow);
    const start = positions.get('__START__');
    const intake = positions.get('INTAKE');
    expect(start).toBeDefined();
    expect(intake).toBeDefined();
    expect(start?.x).toBe(intake?.x);
    expect(start?.y).toBeLessThan(intake?.y as number);
    expect((intake?.y as number) - (start?.y as number)).toBe(160);
  });

  it('adds synthetic __END__ marker below the last spine node', () => {
    const positions = layoutPositions(fullWorkflow);
    const spine = deriveSpine(fullWorkflow);
    const lastSpineState = spine[spine.length - 1];
    const end = positions.get('__END__');
    const lastPos = positions.get(lastSpineState);
    expect(end).toBeDefined();
    expect(lastPos).toBeDefined();
    expect(end?.x).toBe(lastPos?.x);
    expect(end?.y).toBeGreaterThan(lastPos?.y as number);
    expect((end?.y as number) - (lastPos?.y as number)).toBe(160);
  });

  it('places branch nodes beside their related spine node by transition', () => {
    // BRANCH_X transitions TO a spine node (not from a spine node to BRANCH_X),
    // so the DFS resume mechanism won't discover it and it stays off-spine.
    // findRelatedSpineY checks both directions, so it still finds STEP_B.
    const workflow = buildWorkflow({
      states: [
        state('STEP_A'),
        state('STEP_B'),
        state('STEP_C'),
        state('BRANCH_X'),
        state('DONE', 'terminal'),
      ],
      transitions: [
        edge('STEP_A', 'STEP_B', 'completion'),
        edge('STEP_B', 'STEP_C', 'completion'),
        edge('STEP_C', 'DONE', 'completion'),
        edge('BRANCH_X', 'STEP_B', 'rejoin'),
      ],
    });
    const positions = layoutPositions(workflow);
    const branchX = positions.get('BRANCH_X');
    const stepB = positions.get('STEP_B');
    expect(branchX).toBeDefined();
    expect(stepB).toBeDefined();
    // Branch should be in column -1 (different x) but at stepB's y
    expect(branchX?.x).not.toBe(stepB?.x);
    expect(branchX?.y).toBe(stepB?.y);
  });

  it('places branch node at average y of multiple related spine nodes', () => {
    // BRANCH_X only has outgoing transitions TO spine states that already have
    // incoming edges from other spine nodes, so BRANCH_X stays off-spine.
    // STEP_A (listed first, no incoming) is the initial state.
    // findRelatedSpineY checks both directions and finds STEP_B and STEP_C.
    const workflow = buildWorkflow({
      states: [
        state('STEP_A'),
        state('STEP_B'),
        state('STEP_C'),
        state('BRANCH_X'),
        state('DONE', 'terminal'),
      ],
      transitions: [
        edge('STEP_A', 'STEP_B', 'completion'),
        edge('STEP_B', 'STEP_C', 'completion'),
        edge('STEP_C', 'DONE', 'completion'),
        // Both targets already have incoming from spine, so initial detection
        // still picks STEP_A. No spine state has outgoing to BRANCH_X, so
        // the DFS resume cannot discover it.
        edge('BRANCH_X', 'STEP_B', 'back'),
        edge('BRANCH_X', 'STEP_C', 'forward'),
      ],
    });
    const positions = layoutPositions(workflow);
    const branchX = positions.get('BRANCH_X');
    const stepB = positions.get('STEP_B');
    const stepC = positions.get('STEP_C');
    expect(branchX).toBeDefined();
    expect(stepB).toBeDefined();
    expect(stepC).toBeDefined();
    // Spine: STEP_A(y=0), STEP_B(y=160), STEP_C(y=320), DONE(y=480)
    // BRANCH_X related to STEP_B(y=160) and STEP_C(y=320), average = 240
    const expectedY = ((stepB?.y as number) + (stepC?.y as number)) / 2;
    expect(branchX?.y).toBe(expectedY);
  });

  it('places branch node at midY when it has no related spine nodes', () => {
    const workflow = buildWorkflow({
      states: [state('STEP_A'), state('STEP_B'), state('ORPHAN'), state('DONE', 'terminal')],
      transitions: [
        edge('STEP_A', 'STEP_B', 'completion'),
        edge('STEP_B', 'DONE', 'completion'),
        // ORPHAN has no transitions connecting it to spine states
      ],
    });
    const positions = layoutPositions(workflow);
    const orphan = positions.get('ORPHAN');
    const stepA = positions.get('STEP_A');
    const done = positions.get('DONE');
    expect(orphan).toBeDefined();
    expect(stepA).toBeDefined();
    expect(done).toBeDefined();
    // midY = average of all spine node Y positions
    const spine = deriveSpine(workflow);
    const spineYs = spine.map((id) => positions.get(id)?.y ?? 0);
    const expectedMidY = spineYs.reduce((a, b) => a + b, 0) / spineYs.length;
    expect(orphan?.y).toBe(expectedMidY);
  });

  it('resolves collisions between branch nodes in the same column+y', () => {
    // Two branches both related to the same spine node -> same column+y -> collision
    const workflow = buildWorkflow({
      states: [
        state('STEP_A'),
        state('STEP_B'),
        state('BRANCH_1'),
        state('BRANCH_2'),
        state('DONE', 'terminal'),
      ],
      transitions: [
        edge('STEP_A', 'STEP_B', 'completion'),
        edge('STEP_B', 'DONE', 'completion'),
        // Both branches connect to STEP_A only
        edge('STEP_A', 'BRANCH_1', 'side1'),
        edge('STEP_A', 'BRANCH_2', 'side2'),
      ],
    });
    const positions = layoutPositions(workflow);
    const b1 = positions.get('BRANCH_1');
    const b2 = positions.get('BRANCH_2');
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    // Both should be in the same column (same x)
    expect(b1?.x).toBe(b2?.x);
    // After collision resolution, they should have different y values
    expect(b1?.y).not.toBe(b2?.y);
  });

  it('handles collision resolution with multiple terminal-branch states', () => {
    const workflow = buildWorkflow({
      states: [
        state('STEP_A'),
        state('DONE', 'terminal'),
        state('FAILED', 'terminal'),
        state('CANCELLED', 'terminal'),
      ],
      transitions: [
        edge('STEP_A', 'DONE', 'completion'),
        edge('STEP_A', 'FAILED', 'failure'),
        edge('STEP_A', 'CANCELLED', 'cancel'),
      ],
    });
    const positions = layoutPositions(workflow);
    const failed = positions.get('FAILED');
    const cancelled = positions.get('CANCELLED');
    expect(failed).toBeDefined();
    expect(cancelled).toBeDefined();
    // Both are terminal-branch (column 1), placed at maxSpineY initially
    // After collision resolution, they should have different y values
    expect(failed?.y).not.toBe(cancelled?.y);
  });

  it('handles empty workflow without errors', () => {
    const empty = buildWorkflow();
    const positions = layoutPositions(empty);
    // Should at least have __START__ and __END__
    expect(positions.has('__START__')).toBe(true);
    expect(positions.has('__END__')).toBe(true);
  });

  it('handles single-state workflow', () => {
    const workflow = buildWorkflow({
      states: [state('ONLY_STATE')],
      transitions: [],
    });
    const positions = layoutPositions(workflow);
    expect(positions.get('ONLY_STATE')).toBeDefined();
    expect(positions.get('__START__')).toBeDefined();
    expect(positions.get('__END__')).toBeDefined();
  });

  it('does not move spine nodes during collision resolution', () => {
    const positions = layoutPositions(fullWorkflow);
    const spine = deriveSpine(fullWorkflow);
    // All spine nodes should be at column 0 (centerX=400) and at their expected y
    for (let i = 0; i < spine.length; i++) {
      const pos = positions.get(spine[i]);
      expect(pos?.x).toBe(400);
      expect(pos?.y).toBe(i * 160);
    }
  });

  it('places left-column branch at negative offset from centerX', () => {
    // BRANCH_LEFT only has an outgoing transition TO a spine state that already
    // has incoming, so no spine state has outgoing edges to BRANCH_LEFT and
    // the DFS resume cannot discover it.
    const workflow = buildWorkflow({
      states: [state('STEP_A'), state('STEP_B'), state('BRANCH_LEFT'), state('DONE', 'terminal')],
      transitions: [
        edge('STEP_A', 'STEP_B', 'completion'),
        edge('STEP_B', 'DONE', 'completion'),
        edge('BRANCH_LEFT', 'STEP_B', 'rejoin'),
      ],
    });
    const positions = layoutPositions(workflow, 400);
    const branchLeft = positions.get('BRANCH_LEFT');
    expect(branchLeft).toBeDefined();
    // Branch column is -1, so x = 400 + (-1 * COLUMN_OFFSET_PX) = 400 - 380 = 20
    expect(branchLeft?.x).toBe(400 - COLUMN_OFFSET_PX);
  });
});
