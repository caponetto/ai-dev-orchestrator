import type { ModelAssignment, ModelCalibrationEntry, RoleId } from '@ai-orchestrator/schemas';

import { ModelAssignmentError } from '../domain/errors';

interface ModelTier {
  readonly model: string;
  readonly tier: number;
  readonly maxTokens?: number;
}

export interface ModelTierConfig {
  readonly tiers: readonly ModelTier[];
}

const MIN_CALIBRATION_SAMPLES = 3;
const LOW_SUCCESS_THRESHOLD = 0.6;

export interface ModelAssignmentConfig {
  readonly assignments: Readonly<Record<string, Omit<ModelAssignment, 'roleId'>>>;
  readonly defaultAssignment?: Omit<ModelAssignment, 'roleId'>;
  readonly tierConfig?: ModelTierConfig;
}

export class ModelAssigner {
  private readonly config: ModelAssignmentConfig;

  constructor(config: ModelAssignmentConfig) {
    this.config = config;
  }

  getModelAssignment(roleId: RoleId): ModelAssignment {
    const explicit = this.config.assignments[roleId] as Omit<ModelAssignment, 'roleId'> | undefined;
    if (explicit) {
      return { roleId, ...explicit };
    }

    if (this.config.defaultAssignment) {
      return { roleId, ...this.config.defaultAssignment };
    }

    throw new ModelAssignmentError(roleId);
  }

  getNextTier(roleId: RoleId): ModelAssignment | null {
    if (!this.config.tierConfig) {
      return null;
    }

    const current = this.getModelAssignment(roleId);
    const sortedTiers = [...this.config.tierConfig.tiers].sort((a, b) => a.tier - b.tier);
    const currentTier = sortedTiers.find((t) => t.model === current.model);

    if (!currentTier) {
      return null;
    }

    const nextTier = sortedTiers.find((t) => t.tier > currentTier.tier);
    if (!nextTier) {
      return null;
    }

    return { roleId, model: nextTier.model, maxTokens: nextTier.maxTokens };
  }

  getRecommendedModel(
    roleId: RoleId,
    calibrationData?: readonly ModelCalibrationEntry[],
  ): ModelAssignment {
    const defaultAssignment = this.getModelAssignment(roleId);

    if (!calibrationData || !this.config.tierConfig) {
      return defaultAssignment;
    }

    const currentCalibration = calibrationData.find(
      (c) => c.roleId === roleId && c.model === defaultAssignment.model,
    );

    if (
      currentCalibration &&
      currentCalibration.sampleSize >= MIN_CALIBRATION_SAMPLES &&
      currentCalibration.successRate < LOW_SUCCESS_THRESHOLD
    ) {
      const nextTier = this.getNextTier(roleId);
      if (nextTier) {
        return nextTier;
      }
    }

    return defaultAssignment;
  }
}
