import { probeModelAvailability } from '@ai-dev-orchestrator/agent-adapters';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import type { RoleContract, RoleId } from '@ai-dev-orchestrator/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateSelectedModels } from '../model-preflight';

vi.mock('@ai-dev-orchestrator/agent-adapters', () => ({ probeModelAvailability: vi.fn() }));

function role(id: RoleId, overrides: Partial<RoleContract> = {}): RoleContract {
  return {
    id,
    name: id,
    description: '',
    ownedArtifacts: [],
    readableArtifacts: [],
    forbiddenArtifacts: [],
    reviewedBy: [],
    reviews: [],
    agreementParticipation: [],
    requiredCapabilities: [],
    dispatchType: 'agent',
    runner: 'codex',
    ...overrides,
  };
}

function registry(roles: RoleContract[], model = 'selected-model'): DefaultRoleRegistry {
  return new DefaultRoleRegistry(roles, { assignments: {}, defaultAssignment: { model } });
}

beforeEach(() => {
  vi.mocked(probeModelAvailability).mockReset().mockResolvedValue({ available: true });
});

describe('validateSelectedModels', () => {
  it('checks a shared runner/model only once', async () => {
    await expect(
      validateSelectedModels(registry([role('planner'), role('implementer')])),
    ).resolves.toEqual([]);
    expect(probeModelAvailability).toHaveBeenCalledExactlyOnceWith('codex', 'selected-model', {
      cwd: undefined,
    });
  });

  it('uses the dispatch model override before the role assignment', async () => {
    await validateSelectedModels(
      registry([role('planner', { agentConfig: { model: 'override' } })]),
    );
    expect(probeModelAvailability).toHaveBeenCalledExactlyOnceWith('codex', 'override', {
      cwd: undefined,
    });
  });

  it('checks the runner default for the agent sentinel model', async () => {
    await validateSelectedModels(registry([role('planner')], 'agent'));
    expect(probeModelAvailability).toHaveBeenCalledExactlyOnceWith('codex', undefined, {
      cwd: undefined,
    });
  });

  it('keeps the same model on different runners separate', async () => {
    await validateSelectedModels(
      registry([role('planner'), role('implementer', { runner: 'cursor' })]),
    );
    expect(probeModelAvailability).toHaveBeenCalledTimes(2);
  });

  it('reports all failing models with every affected role', async () => {
    vi.mocked(probeModelAvailability).mockResolvedValue({
      available: false,
      detail: 'Model retired',
    });
    const result = validateSelectedModels(
      registry([
        role('planner'),
        role('implementer'),
        role('judge', { runner: 'cursor' }),
        role('verifier', { runner: 'opencode' }),
      ]),
    );
    await expect(result).rejects.toThrow(
      /codex.*planner, implementer.*Model retired[\s\S]*cursor.*judge[\s\S]*opencode.*verifier/u,
    );
    expect(probeModelAvailability).toHaveBeenCalledTimes(3);
  });

  it('reports an unavailable default model without inventing a model name', async () => {
    vi.mocked(probeModelAvailability).mockResolvedValue({ available: false });
    await expect(validateSelectedModels(registry([role('planner')], 'agent'))).rejects.toThrow(
      '(runner default)',
    );
  });

  it('explicitly warns when custom runners or commands cannot be checked', async () => {
    const warnings = await validateSelectedModels(
      registry([
        role('planner', { runner: 'http' }),
        role('implementer', { agentConfig: { command: 'custom-codex' } }),
        role('judge', { agentConfig: { args: ['custom'] } }),
      ]),
    );
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toContain('not checked');
    expect(probeModelAvailability).not.toHaveBeenCalled();
  });

  it('rejects a role without a runner', async () => {
    await expect(
      validateSelectedModels(registry([role('planner', { runner: undefined })])),
    ).rejects.toThrow('no runner configured');
  });
});
