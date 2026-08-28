import { describe, expect, it } from 'vitest';

import { BUILT_IN_CODING_RUNNER_ID, BUILT_IN_CODING_RUNNER_IDS } from '../built-in-runner-ids';

describe('built-in coding runner IDs', () => {
  it('defines each supported local coding runner once', () => {
    expect(BUILT_IN_CODING_RUNNER_IDS).toEqual([
      BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
      BUILT_IN_CODING_RUNNER_ID.CODEX,
      BUILT_IN_CODING_RUNNER_ID.CURSOR,
    ]);
    expect(new Set(BUILT_IN_CODING_RUNNER_IDS)).toHaveLength(BUILT_IN_CODING_RUNNER_IDS.length);
  });
});
