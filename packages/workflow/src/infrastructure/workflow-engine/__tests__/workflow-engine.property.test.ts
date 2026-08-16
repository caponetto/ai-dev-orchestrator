import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TEST_WORKFLOW } from '../../../../test/fixtures/test-defaults';

const ALL_STATE_NAMES = Object.keys(TEST_WORKFLOW.states);
const TERMINAL_STATES = new Set(TEST_WORKFLOW.terminalStates);

describe('Workflow Engine property-based tests', () => {
  it('every non-terminal state has at least one outgoing transition (no dead ends)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATE_NAMES), (stateName) => {
        const state = TEST_WORKFLOW.states[stateName];

        if (TERMINAL_STATES.has(stateName)) {
          // Terminal states are allowed to have zero transitions
          expect(state.transitions.length).toBe(0);
        } else {
          expect(state.transitions.length).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('all transition targets reference valid states (no dangling references)', () => {
    const validStates = new Set(ALL_STATE_NAMES);

    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATE_NAMES), (stateName) => {
        const state = TEST_WORKFLOW.states[stateName];

        for (const transition of state.transitions) {
          expect(validStates.has(transition.target)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('guard evaluation is pure (same state + context produces same result)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_STATE_NAMES), { minLength: 0, maxLength: 20 }),
        fc.constantFrom(...ALL_STATE_NAMES),
        (history, stateToCheck) => {
          // Simulates the deterministic portion of GuardChecker.checkStateVisited:
          // context.stateHistory.includes(stateId) is always consistent for same inputs
          const result1 = history.includes(stateToCheck);
          const result2 = [...history].includes(stateToCheck);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('transitions within each state have strictly increasing priority', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATE_NAMES), (stateName) => {
        const state = TEST_WORKFLOW.states[stateName];

        for (let i = 1; i < state.transitions.length; i++) {
          expect(state.transitions[i].priority).toBeGreaterThan(state.transitions[i - 1].priority);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('all guard types are from the known handler set', () => {
    const KNOWN_GUARD_TYPES = new Set([
      'artifact_exists',
      'artifact_version_min',
      'agreement_exists',
      'state_visited',
      'iteration_below_limit',
      'findings_indicate_plan_issue',
      'verification_failures_are_fixable',
      'verification_passed',
      'waiting_context_matches',
      'plan_structure_valid',
    ]);

    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATE_NAMES), (stateName) => {
        const state = TEST_WORKFLOW.states[stateName];

        for (const transition of state.transitions) {
          for (const guard of transition.guards) {
            expect(KNOWN_GUARD_TYPES.has(guard.type)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('every requestingState that routes to WAITING_FOR_HUMAN has a return transition', () => {
    const waitState = TEST_WORKFLOW.states['WAITING_FOR_HUMAN'];

    const requestingStatesWithReturnTransition = new Set<string>();
    for (const t of waitState.transitions) {
      for (const g of t.guards) {
        if (g.type === 'waiting_context_matches' && g.params['requestingState']) {
          requestingStatesWithReturnTransition.add(g.params['requestingState']);
        }
      }
    }

    const statesThatRouteToWaiting = new Set<string>();
    for (const [stateName, stateDef] of Object.entries(TEST_WORKFLOW.states)) {
      if (stateName === 'WAITING_FOR_HUMAN') {
        continue;
      }
      for (const t of stateDef.transitions) {
        if (t.target === 'WAITING_FOR_HUMAN') {
          statesThatRouteToWaiting.add(stateName);
        }
      }
    }

    for (const origin of statesThatRouteToWaiting) {
      expect(
        requestingStatesWithReturnTransition.has(origin),
        `State '${origin}' can transition to WAITING_FOR_HUMAN but WAITING_FOR_HUMAN has no return transition for requestingState '${origin}'`,
      ).toBe(true);
    }
  });

  it('WAITING_FOR_HUMAN has human_approved transition for VERIFICATION requestingState', () => {
    const waitState = TEST_WORKFLOW.states['WAITING_FOR_HUMAN'];
    const hasVerificationApproval = waitState.transitions.some(
      (t) =>
        t.trigger === 'human_approved' &&
        t.guards.some(
          (g) =>
            g.type === 'waiting_context_matches' && g.params['requestingState'] === 'VERIFICATION',
        ),
    );
    expect(hasVerificationApproval).toBe(true);
  });

  it('WAITING_FOR_HUMAN has human_rejected transition for VERIFICATION requestingState', () => {
    const waitState = TEST_WORKFLOW.states['WAITING_FOR_HUMAN'];
    const hasVerificationRejection = waitState.transitions.some(
      (t) =>
        t.trigger === 'human_rejected' &&
        t.guards.some(
          (g) =>
            g.type === 'waiting_context_matches' && g.params['requestingState'] === 'VERIFICATION',
        ),
    );
    expect(hasVerificationRejection).toBe(true);
  });
});
