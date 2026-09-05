import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { hashContent } from '@ai-dev-orchestrator/utils';
import { stringify } from 'yaml';

import { StateCorruptionError } from '../../domain/state-persistence/errors';

/** Compute a checksum over all state fields except the checksum itself. */
export function computeStateChecksum(state: PersistedState): string {
  const { checksum: _checksum, ...rest } = state;
  const content = stringify(rest);
  return hashContent(content);
}

/** Verify that a persisted state's checksum is valid. Throws on mismatch. */
export function verifyStateChecksum(state: PersistedState): void {
  const expected = computeStateChecksum(state);
  if (state.checksum !== expected) {
    throw new StateCorruptionError(expected, state.checksum);
  }
}
