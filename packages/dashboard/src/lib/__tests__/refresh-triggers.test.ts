import { describe, expect, it } from 'vitest';

import { shouldRefreshHealth, shouldRefreshUsage } from '../refresh-triggers';

describe('shouldRefreshUsage', () => {
  it.each(['state_changed', 'worker_completed', 'run_completed'])(
    'returns true for %s',
    (eventType) => {
      expect(shouldRefreshUsage(eventType)).toBe(true);
    },
  );

  it.each(['artifact_produced', 'finding_added', 'permission_requested', 'health_changed'])(
    'returns false for %s',
    (eventType) => {
      expect(shouldRefreshUsage(eventType)).toBe(false);
    },
  );
});

describe('shouldRefreshHealth', () => {
  it.each(['health_changed', 'run_started', 'run_completed', 'run_aborted'])(
    'returns true for %s',
    (eventType) => {
      expect(shouldRefreshHealth(eventType)).toBe(true);
    },
  );

  it.each(['state_changed', 'artifact_produced', 'worker_dispatched', 'finding_added'])(
    'returns false for %s',
    (eventType) => {
      expect(shouldRefreshHealth(eventType)).toBe(false);
    },
  );
});
