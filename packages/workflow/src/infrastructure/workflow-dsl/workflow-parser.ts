import type { StateDefinition, WorkflowDefinition } from '@ai-orchestrator/schemas';
import { workflowSchema } from '@ai-orchestrator/schemas';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

import { WorkflowParseError } from '../../domain/workflow-dsl/errors';

/** Parses YAML workflow definitions into typed workflow structures. */
export class WorkflowParser {
  /** Parse a YAML string into a WorkflowDefinition. */
  parse(yaml: string): WorkflowDefinition {
    if (!yaml.trim()) {
      throw new WorkflowParseError('yaml', 'Input is empty');
    }

    let raw: unknown;
    try {
      raw = parseYaml(yaml);
    } catch (e: unknown) {
      throw new WorkflowParseError('yaml', e instanceof Error ? e.message : String(e));
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new WorkflowParseError('yaml', 'Workflow must be a YAML mapping');
    }

    const result = workflowSchema.safeParse(raw);
    if (!result.success) {
      throw new WorkflowParseError(
        'yaml',
        formatZodError(result.error, raw as Record<string, unknown>),
      );
    }

    const states: Record<string, StateDefinition> = {};
    for (const [id, state] of Object.entries(result.data.states)) {
      states[id] = {
        type: state.type,
        ...(state.label ? { label: state.label } : {}),
        description: state.description,
        transitions: state.transitions,
        ...(state.entryActions?.length ? { entryActions: state.entryActions } : {}),
        ...(state.exitActions?.length ? { exitActions: state.exitActions } : {}),
      };
    }

    return {
      name: result.data.name,
      version: result.data.version,
      initialState: result.data.initialState,
      terminalStates: result.data.terminalStates,
      states,
    };
  }
}

function getAtPath(obj: unknown, path: readonly PropertyKey[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function formatZodError(error: z.ZodError, raw: Record<string, unknown>): string {
  const issue = error.issues[0];
  const path = issue.path as (string | number)[];
  const lastKey = path.length > 0 ? String(path[path.length - 1]) : '';

  if (path.length === 1) {
    const field = String(path[0]);
    if (issue.code === 'invalid_type') {
      if (issue.expected === 'array') {
        return `Missing required field "${field}" (must be a non-empty array)`;
      }
      if (issue.expected === 'object') {
        return `Missing required field "${field}" (must be an object)`;
      }
      return `Missing required field "${field}"`;
    }
    if (issue.code === 'too_small') {
      const origin = 'origin' in issue ? issue.origin : undefined;
      if (origin === 'array') {
        return `Missing required field "${field}" (must be a non-empty array)`;
      }
      return `Missing required field "${field}"`;
    }
  }

  if (path.length === 2 && path[0] === 'states' && issue.code === 'invalid_type') {
    return `State "${String(path[1])}" must be an object`;
  }

  if (issue.code === 'invalid_value') {
    const received = String(getAtPath(raw, path));
    if (path.length === 3 && path[0] === 'states' && lastKey === 'type') {
      return `State "${String(path[1])}" has invalid type "${received}"`;
    }
    if (lastKey === 'trigger') {
      return `State "${String(path[1])}" transition[${String(path[3])}] has invalid trigger "${received}"`;
    }
    if (lastKey === 'type' && path.includes('guards')) {
      return `Unknown guard type "${received}"`;
    }
    if (lastKey === 'type' && (path.includes('entryActions') || path.includes('exitActions'))) {
      return `Unknown action type "${received}"`;
    }
  }

  return issue.message;
}
