import type {
  WorkflowDefinition,
  WorkflowValidationError,
  WorkflowValidationResult,
  WorkflowValidationWarning,
} from '@ai-orchestrator/schemas';
import { ACTION_TYPES, GUARD_TYPES, TRANSITION_TRIGGERS } from '@ai-orchestrator/schemas';
const VALID_TRIGGERS: ReadonlySet<string> = new Set<string>(TRANSITION_TRIGGERS);

const VALID_GUARD_TYPES: ReadonlySet<string> = new Set<string>(GUARD_TYPES);

const VALID_ACTION_TYPES: ReadonlySet<string> = new Set<string>(ACTION_TYPES);

/** Validates workflow definitions for structural correctness and semantic soundness. */
export class WorkflowValidator {
  /** Validate a workflow definition, returning errors and warnings. */
  validate(definition: WorkflowDefinition): WorkflowValidationResult {
    const errors: WorkflowValidationError[] = [];
    const warnings: WorkflowValidationWarning[] = [];

    this.checkInitialStateExists(definition, errors);
    this.checkTerminalStatesExist(definition, errors);
    this.checkTerminalNoTransitions(definition, errors);
    this.checkValidTargets(definition, errors);
    this.checkValidTriggers(definition, errors);
    this.checkValidGuards(definition, errors);
    this.checkValidActions(definition, errors);
    this.checkCompleteness(definition, errors);
    this.checkReachability(definition, errors);
    this.checkTerminalConvergence(definition, errors);
    this.checkNoOrphans(definition, errors);
    this.checkDeterminism(definition, errors);
    this.checkParallelWellFormed(definition, errors);
    this.checkNoInfiniteLoops(definition, warnings);

    return { valid: errors.length === 0, errors, warnings };
  }

  private checkInitialStateExists(
    def: WorkflowDefinition,
    errors: WorkflowValidationError[],
  ): void {
    if (!(def.initialState in def.states)) {
      errors.push({
        rule: 'initial_state_exists',
        message: `Initial state "${def.initialState}" is not defined in states`,
      });
    }
  }

  private checkTerminalStatesExist(
    def: WorkflowDefinition,
    errors: WorkflowValidationError[],
  ): void {
    for (const terminal of def.terminalStates) {
      if (!(terminal in def.states)) {
        errors.push({
          rule: 'terminal_states_exist',
          message: `Terminal state "${terminal}" is not defined in states`,
          location: { state: terminal },
        });
      }
    }
  }

  private checkTerminalNoTransitions(
    def: WorkflowDefinition,
    errors: WorkflowValidationError[],
  ): void {
    for (const terminal of def.terminalStates) {
      if (!(terminal in def.states)) {
        continue;
      }
      const state = def.states[terminal];
      if (state.transitions.length > 0) {
        errors.push({
          rule: 'terminal_no_transitions',
          message: `Terminal state "${terminal}" must not have outgoing transitions`,
          location: { state: terminal },
        });
      }
    }
  }

  private checkValidTargets(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      for (let i = 0; i < state.transitions.length; i++) {
        const target = state.transitions[i].target;
        if (!(target in def.states)) {
          errors.push({
            rule: 'valid_targets',
            message: `State "${stateId}" transition[${String(i)}] targets unknown state "${target}"`,
            location: { state: stateId, transition: i },
          });
        }
      }
    }
  }

  private checkValidTriggers(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      for (let i = 0; i < state.transitions.length; i++) {
        const trigger = state.transitions[i].trigger;
        if (!VALID_TRIGGERS.has(trigger)) {
          errors.push({
            rule: 'valid_triggers',
            message: `State "${stateId}" transition[${String(i)}] has unknown trigger "${trigger}"`,
            location: { state: stateId, transition: i },
          });
        }
      }
    }
  }

  private checkValidGuards(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      for (let i = 0; i < state.transitions.length; i++) {
        for (const guard of state.transitions[i].guards) {
          if (!VALID_GUARD_TYPES.has(guard.type)) {
            errors.push({
              rule: 'valid_guards',
              message: `State "${stateId}" transition[${String(i)}] has unknown guard type "${guard.type}"`,
              location: { state: stateId, transition: i },
            });
          }
        }
      }
    }
  }

  private checkValidActions(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      const allActions = [...(state.entryActions ?? []), ...(state.exitActions ?? [])];
      for (const action of allActions) {
        if (!VALID_ACTION_TYPES.has(action.type)) {
          errors.push({
            rule: 'valid_actions',
            message: `State "${stateId}" has unknown action type "${action.type}"`,
            location: { state: stateId },
          });
        }
      }
    }
  }

  private checkCompleteness(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    const terminalSet = new Set(def.terminalStates);
    for (const [stateId, state] of Object.entries(def.states)) {
      if (!terminalSet.has(stateId) && state.transitions.length === 0) {
        errors.push({
          rule: 'completeness',
          message: `Non-terminal state "${stateId}" has no outgoing transitions`,
          location: { state: stateId },
        });
      }
    }
  }

  private checkReachability(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    const reachable = this.computeReachable(def, def.initialState);
    for (const stateId of Object.keys(def.states)) {
      if (!reachable.has(stateId)) {
        errors.push({
          rule: 'reachability',
          message: `State "${stateId}" is not reachable from initial state "${def.initialState}"`,
          location: { state: stateId },
        });
      }
    }
  }

  private checkTerminalConvergence(
    def: WorkflowDefinition,
    errors: WorkflowValidationError[],
  ): void {
    const terminalSet = new Set(def.terminalStates);
    for (const stateId of Object.keys(def.states)) {
      if (terminalSet.has(stateId)) {
        continue;
      }
      const reachable = this.computeReachable(def, stateId);
      const canReachTerminal = [...reachable].some((s) => terminalSet.has(s));
      if (!canReachTerminal) {
        errors.push({
          rule: 'terminal_convergence',
          message: `State "${stateId}" cannot reach any terminal state`,
          location: { state: stateId },
        });
      }
    }
  }

  private checkNoOrphans(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    const referenced = new Set<string>([def.initialState, ...def.terminalStates]);
    for (const state of Object.values(def.states)) {
      for (const transition of state.transitions) {
        referenced.add(transition.target);
      }
    }
    for (const stateId of Object.keys(def.states)) {
      if (!referenced.has(stateId)) {
        errors.push({
          rule: 'no_orphans',
          message: `State "${stateId}" is never referenced as a target, initial, or terminal state`,
          location: { state: stateId },
        });
      }
    }
  }

  private checkDeterminism(def: WorkflowDefinition, errors: WorkflowValidationError[]): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      const seen = new Set<string>();
      for (let i = 0; i < state.transitions.length; i++) {
        const t = state.transitions[i];
        const key = `${t.trigger}:${String(t.priority)}`;
        if (seen.has(key)) {
          errors.push({
            rule: 'determinism',
            message: `State "${stateId}" has duplicate trigger+priority: "${t.trigger}" at priority ${String(t.priority)}`,
            location: { state: stateId, transition: i },
          });
        }
        seen.add(key);
      }
    }
  }

  private checkParallelWellFormed(
    def: WorkflowDefinition,
    errors: WorkflowValidationError[],
  ): void {
    for (const [stateId, state] of Object.entries(def.states)) {
      const entryActions = state.entryActions ?? [];
      const hasFork = entryActions.some(
        (a) => a.type === 'dispatch_worker' && a.params['parallel'] === true,
      );
      if (hasFork) {
        const hasJoinTransition = state.transitions.some((t) =>
          t.guards.some((g) => g.params['waitForAll'] === true),
        );
        if (!hasJoinTransition) {
          errors.push({
            rule: 'parallel_well_formed',
            message: `State "${stateId}" has a parallel fork but no corresponding join guard`,
            location: { state: stateId },
          });
        }
      }
    }
  }

  private checkNoInfiniteLoops(
    def: WorkflowDefinition,
    warnings: WorkflowValidationWarning[],
  ): void {
    const terminalSet = new Set(def.terminalStates);
    const cycles = this.findCycles(def);
    for (const cycle of cycles) {
      const cycleStates = new Set(cycle);
      let hasExit = false;
      for (const stateId of cycle) {
        const state = def.states[stateId];
        for (const transition of state.transitions) {
          if (!cycleStates.has(transition.target) || terminalSet.has(transition.target)) {
            hasExit = true;
            break;
          }
        }
        if (hasExit) {
          break;
        }
      }
      if (!hasExit) {
        warnings.push({
          rule: 'no_infinite_loops',
          message: `Cycle detected with no exit: ${cycle.join(' → ')}`,
          suggestion: 'Add an exit transition or iteration limit guard to break the cycle',
        });
      }
    }
  }

  private computeReachable(def: WorkflowDefinition, from: string): Set<string> {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      if (!(current in def.states)) {
        continue;
      }
      const state = def.states[current];
      for (const transition of state.transitions) {
        if (!visited.has(transition.target)) {
          queue.push(transition.target);
        }
      }
    }
    return visited;
  }

  private findCycles(def: WorkflowDefinition): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (stateId: string): void => {
      if (stack.has(stateId)) {
        const cycleStart = path.indexOf(stateId);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      if (visited.has(stateId)) {
        return;
      }

      visited.add(stateId);
      stack.add(stateId);
      path.push(stateId);

      if (stateId in def.states) {
        const state = def.states[stateId];
        for (const transition of state.transitions) {
          dfs(transition.target);
        }
      }

      path.pop();
      stack.delete(stateId);
    };

    for (const stateId of Object.keys(def.states)) {
      if (!visited.has(stateId)) {
        dfs(stateId);
      }
    }

    return cycles;
  }
}
