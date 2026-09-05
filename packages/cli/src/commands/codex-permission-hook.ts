import { CODEX_HOOK_CONTEXT_ENV, handleCodexPermissionHook } from '@ai-dev-orchestrator/runner';

export async function codexPermissionHookCommand(): Promise<number> {
  const contextPath = process.env[CODEX_HOOK_CONTEXT_ENV];
  if (!contextPath) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'deny',
            message: 'Missing orchestrator Codex permission hook context',
          },
        },
      }),
    );
    return 1;
  }

  const response = await handleCodexPermissionHook(contextPath);
  process.stdout.write(response);
  return 0;
}
