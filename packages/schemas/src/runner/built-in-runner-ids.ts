/** Stable identifiers for the built-in local coding-agent runners. */
export const BUILT_IN_CODING_RUNNER_ID = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  CURSOR: 'cursor',
} as const;

export type BuiltInCodingRunnerId =
  (typeof BUILT_IN_CODING_RUNNER_ID)[keyof typeof BUILT_IN_CODING_RUNNER_ID];

export const BUILT_IN_CODING_RUNNER_IDS: readonly BuiltInCodingRunnerId[] = [
  BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
  BUILT_IN_CODING_RUNNER_ID.CODEX,
  BUILT_IN_CODING_RUNNER_ID.CURSOR,
];
