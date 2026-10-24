import type { AgentSessionSupervisor, RunnerSystem } from '@ai-dev-orchestrator/ports';
import type { RunId } from '@ai-dev-orchestrator/schemas';

/** Start script, worker and session cancellation independently; one failed backend cannot block the others. */
export async function cancelWorkflowExecution(
  runner: RunnerSystem,
  supervisor: AgentSessionSupervisor | undefined,
  runId: RunId,
  reason: string,
  cancelScripts?: () => Promise<void>,
): Promise<void> {
  await Promise.allSettled([
    (async () => {
      await cancelScripts?.();
    })(),
    (async () => {
      await runner.cancelAllWorkers();
    })(),
    (async () => {
      if (!supervisor) {
        return;
      }
      const sessions = await supervisor.listByRun(runId);
      const ids = new Set(
        sessions
          .filter(
            (session) =>
              session.ref.runId === runId &&
              !['completed', 'failed', 'aborted'].includes(session.state),
          )
          .map((session) => session.ref.sessionId),
      );
      await Promise.allSettled(
        [...ids].map(async (id) => {
          await supervisor.abort(id, reason);
        }),
      );
    })(),
  ]);
}
