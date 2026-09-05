import { existsSync, readFileSync } from 'node:fs';

import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';
import { parse } from 'yaml';

import { StatePersistenceError } from '../../domain/state-persistence/errors';

/** Read and parse a persisted state YAML file. */
export function readState(filePath: string): PersistedState | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = parse(content);

    if (typeof parsed !== 'object' || parsed === null) {
      throw new StatePersistenceError(`Invalid state file: expected object, got ${typeof parsed}`);
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj['runId'] !== 'string' || typeof obj['currentState'] !== 'string') {
      throw new StatePersistenceError(
        'Invalid state file: missing required fields runId or currentState',
      );
    }

    return parsed as PersistedState;
  } catch (error: unknown) {
    if (error instanceof StatePersistenceError) {
      throw error;
    }
    const message = getErrorMessage(error);
    throw new StatePersistenceError(`Failed to read state from "${filePath}": ${message}`);
  }
}

/** Read the raw YAML content of a state file for checksum computation. */
export function readStateRaw(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, 'utf8');
}
