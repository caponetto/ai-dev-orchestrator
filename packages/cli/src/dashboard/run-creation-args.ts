import type { RunCreationParams } from '@ai-dev-orchestrator/schemas';

/**
 * Mapping from RunCreationParams optional fields to their CLI flag equivalents.
 * Adding a field to RunCreationParams without updating this map produces a type error.
 * `runSettings` is API-only and applied by the dashboard server before spawning the CLI.
 */
const CLI_FLAG_MAP: {
  readonly [K in keyof Omit<RunCreationParams, 'prompt' | 'runSettings'>]-?: string;
} = {
  workflow: '--workflow',
  repoRoot: '--repo',
};

/**
 * Converts typed RunCreationParams into a CLI argument array for `ai run`.
 * Exhaustiveness is enforced at compile time via CLI_FLAG_MAP.
 */
export function runCreationParamsToCliArgs(params: RunCreationParams): string[] {
  const args: string[] = ['run'];

  for (const [key, flag] of Object.entries(CLI_FLAG_MAP)) {
    const value = params[key as keyof typeof CLI_FLAG_MAP];
    if (value) {
      args.push(flag, value);
    }
  }

  args.push(params.prompt);
  return args;
}
