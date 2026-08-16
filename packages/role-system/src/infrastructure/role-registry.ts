import type { OwnershipRegistry, RoleRegistry } from '@ai-orchestrator/ports';
import type {
  AgentConfig,
  ArtifactType,
  DispatchType,
  ModelAssignment,
  ModelCalibrationEntry,
  RoleContract,
  RoleId,
  RoleValidationResult,
} from '@ai-orchestrator/schemas';

import { validateContracts } from './contract-validator';
import type { ModelAssignmentConfig } from './model-assigner';
import { ModelAssigner } from './model-assigner';

export interface DispatchOverride {
  readonly dispatchType?: DispatchType;
  readonly runner?: string;
  readonly agentConfig?: AgentConfig;
}

export class DefaultRoleRegistry implements RoleRegistry, OwnershipRegistry {
  private readonly roles: Map<string, RoleContract>;
  private readonly modelAssigner: ModelAssigner;

  constructor(
    builtInRoles: readonly RoleContract[],
    modelConfig: ModelAssignmentConfig,
    dispatchOverrides?: Readonly<Record<string, DispatchOverride>>,
  ) {
    const map = new Map<string, RoleContract>();
    for (const role of builtInRoles) {
      const override = dispatchOverrides?.[role.id];
      const merged = override ? this.mergeDispatch(role, override) : role;
      map.set(role.id, merged);
    }
    this.roles = map;
    this.modelAssigner = new ModelAssigner(modelConfig);
  }

  private mergeDispatch(role: RoleContract, override: DispatchOverride): RoleContract {
    return {
      ...role,
      dispatchType: override.dispatchType ?? role.dispatchType,
      runner: override.runner ?? role.runner,
      agentConfig: override.agentConfig
        ? { ...role.agentConfig, ...override.agentConfig }
        : role.agentConfig,
    };
  }

  getRole(roleId: RoleId): RoleContract | null {
    return this.roles.get(roleId) ?? null;
  }

  listRoles(): RoleContract[] {
    return [...this.roles.values()];
  }

  getModelAssignment(roleId: RoleId): ModelAssignment {
    return this.modelAssigner.getModelAssignment(roleId);
  }

  getRecommendedModel(
    roleId: RoleId,
    calibrationData?: readonly ModelCalibrationEntry[],
  ): ModelAssignment {
    return this.modelAssigner.getRecommendedModel(roleId, calibrationData);
  }

  getNextTier(roleId: RoleId): ModelAssignment | null {
    return this.modelAssigner.getNextTier(roleId);
  }

  validate(): RoleValidationResult {
    return validateContracts([...this.roles.values()]);
  }

  getOwner(type: ArtifactType): string | null {
    for (const role of this.roles.values()) {
      if (role.ownedArtifacts.includes(type)) {
        return role.id;
      }
    }
    return null;
  }

  isAuthorized(role: string, type: ArtifactType): boolean {
    const contract = this.roles.get(role);
    if (!contract) {
      return false;
    }
    return contract.ownedArtifacts.includes(type);
  }

  getOwnedTypes(role: string): ArtifactType[] {
    const contract = this.roles.get(role);
    if (!contract) {
      return [];
    }
    return [...contract.ownedArtifacts];
  }
}
