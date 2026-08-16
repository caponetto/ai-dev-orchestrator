import type {
  ModelAssignment,
  ModelCalibrationEntry,
  RoleContract,
  RoleId,
  RoleValidationResult,
} from '@ai-orchestrator/schemas';

/** Port for querying role contracts and model assignments. */
export interface RoleRegistry {
  /** Get a role contract by ID. Returns null if not found. */
  getRole(roleId: RoleId): RoleContract | null;

  /** List all registered roles. */
  listRoles(): readonly RoleContract[];

  /** Get the model assignment for a role. */
  getModelAssignment(roleId: RoleId): ModelAssignment;

  /** Get the recommended model for a role, optionally using calibration data from previous runs. */
  getRecommendedModel(
    roleId: RoleId,
    calibrationData?: readonly ModelCalibrationEntry[],
  ): ModelAssignment;

  /** Get the next model tier for a role, or null if already at the highest tier. */
  getNextTier(roleId: RoleId): ModelAssignment | null;

  /** Validate the complete role configuration. */
  validate(): RoleValidationResult;
}
