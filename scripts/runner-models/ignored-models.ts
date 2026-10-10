/**
 * Patterns for models a CLI exposes that we deliberately do not list in runners.yaml, so they are
 * never reported as new. Each pattern must match the whole model id.
 */
export const IGNORED_MODELS: Record<string, RegExp[]> = {
  'claude-code': [/claude-(opus|sonnet|haiku)-4(-0)?/, /claude-(haiku-3-5|haiku-3-55|sonnet-3-7)/],
  codex: [/gpt-reserve/, /codex-auto-review/, /gpt-daybreak-.*/],
  opencode: [],
};
