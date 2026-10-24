import type {
  ModelAssignment,
  ModelCalibrationEntry,
  RoleContract,
  RoleId,
  RoleValidationResult,
} from '@ai-dev-orchestrator/schemas';

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

  /** Get the tier above currentModel (or the role's configured model), or null at the highest tier. */
  getNextTier(roleId: RoleId, currentModel?: string): ModelAssignment | null;

  /** Validate the complete role configuration. */
  validate(): RoleValidationResult;
}
