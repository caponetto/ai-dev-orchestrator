import { probeModelAvailability } from '@ai-dev-orchestrator/agent-adapters';
import type { RoleRegistry } from '@ai-dev-orchestrator/ports';
import type { WorkflowDefinition } from '@ai-dev-orchestrator/schemas';
import { BUILT_IN_CODING_RUNNER_IDS } from '@ai-dev-orchestrator/schemas';

/**
 * Collect every role ID a workflow can dispatch, across all states and dispatch
 * action variants (single, parallel, and dynamic workers).
 */
export function collectDispatchedRoleIds(workflow: WorkflowDefinition): Set<string> {
  const roleIds = new Set<string>();
  for (const state of Object.values(workflow.states)) {
    for (const action of state.entryActions ?? []) {
      if (action.type === 'dispatch_worker' || action.type === 'dispatch_dynamic_workers') {
        roleIds.add(action.params.role);
      } else if (action.type === 'dispatch_parallel_workers') {
        for (const role of action.params.roles) {
          roleIds.add(role);
        }
        for (const role of action.params.docsOnlyRoles ?? []) {
          roleIds.add(role);
        }
      }
    }
  }
  return roleIds;
}

/** Validate each effective runner/model pair once, collecting every affected role. */
export async function validateSelectedModels(
  registry: RoleRegistry,
  repoRoot?: string,
  verified = false,
  roleFilter?: ReadonlySet<string>,
): Promise<string[]> {
  const checks = new Map<string, { runner: string; model?: string; roles: string[] }>();
  const warnings: string[] = [];
  for (const role of registry.listRoles()) {
    // When the run's workflow is known, only validate the roles it can dispatch;
    // an unavailable runner for an unrelated workflow's role must not block the run.
    if (roleFilter && !roleFilter.has(role.id)) {
      continue;
    }
    const runner = role.runner;
    if (!runner) {
      throw new Error(`Role "${role.id}" has no runner configured.`);
    }
    if (
      !BUILT_IN_CODING_RUNNER_IDS.some((id) => id === runner) ||
      role.agentConfig?.command ||
      role.agentConfig?.args
    ) {
      warnings.push(
        `Model availability was not checked for role "${role.id}" (custom runner configuration).`,
      );
      continue;
    }
    const assignedModel = registry.getModelAssignment(role.id).model;
    const model =
      role.agentConfig?.model ?? (assignedModel === 'agent' ? undefined : assignedModel);
    const key = JSON.stringify([runner, model]);
    const check = checks.get(key);
    if (check) {
      check.roles.push(role.id);
    } else {
      checks.set(key, { runner, model, roles: [role.id] });
    }
  }

  const failures: string[] = [];
  if (verified) {
    return warnings;
  }
  const pending = [...checks.values()];
  // Bound concurrent subprocesses and provider requests, without stopping at the first failure.
  for (let index = 0; index < pending.length; index += 2) {
    const results = await Promise.all(
      pending.slice(index, index + 2).map(async (check) => ({
        check,
        result: await probeModelAvailability(check.runner, check.model, { cwd: repoRoot }),
      })),
    );
    for (const { check, result } of results) {
      if (!result.available) {
        failures.push(
          `- ${check.runner} / ${check.model ?? '(runner default)'} (roles: ${check.roles.join(', ')}): ${result.detail ?? 'Unavailable'}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Model availability preflight failed. No run was started.\n${failures.join('\n')}\n` +
        'Choose an available model in the run configuration, check provider authentication, or retry if the provider is temporarily unavailable.',
    );
  }
  return warnings;
}
