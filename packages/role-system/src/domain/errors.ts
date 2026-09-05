import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { ArtifactType } from '@ai-dev-orchestrator/schemas';

/** Thrown when a requested role is not found in the registry. */
export class RoleNotFoundError extends NonRecoverableErrorBase {
  readonly code = 'ROLE_NOT_FOUND';

  constructor(readonly roleId: string) {
    super(`Role not found: "${roleId}"`);
  }
}

/** Thrown when two roles claim ownership of the same artifact type. */
export class OwnershipConflictError extends NonRecoverableErrorBase {
  readonly code = 'OWNERSHIP_CONFLICT';

  constructor(
    readonly artifactType: ArtifactType,
    readonly roleA: string,
    readonly roleB: string,
  ) {
    super(
      `Ownership conflict for artifact type "${artifactType}": claimed by both "${roleA}" and "${roleB}"`,
    );
  }
}

/** Thrown when a role attempts an operation it is not authorized for. */
export class PermissionDeniedError extends NonRecoverableErrorBase {
  readonly code = 'PERMISSION_DENIED';

  constructor(
    readonly roleId: string,
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`Permission denied for role "${roleId}": ${operation} — ${reason}`);
  }
}

/** Thrown when a role attempts to read an artifact type not in its readable list. */
export class VisibilityViolationError extends NonRecoverableErrorBase {
  readonly code = 'VISIBILITY_VIOLATION';

  constructor(
    readonly roleId: string,
    readonly artifactType: ArtifactType,
  ) {
    super(
      `Role "${roleId}" cannot read artifact type "${artifactType}": not in readable artifacts`,
    );
  }
}

/** Thrown when a circular review chain is detected. */
export class CircularReviewError extends NonRecoverableErrorBase {
  readonly code = 'CIRCULAR_REVIEW';

  constructor(readonly chain: readonly string[]) {
    super(`Circular review chain detected: ${chain.join(' → ')}`);
  }
}

/** Thrown when no model assignment exists for a role and no default is configured. */
export class ModelAssignmentError extends NonRecoverableErrorBase {
  readonly code = 'MODEL_ASSIGNMENT_ERROR';

  constructor(readonly roleId: string) {
    super(`No model assignment for role "${roleId}" and no default configured`);
  }
}

/** Thrown when runtime role registration fails due to ID conflict or ownership overlap. */
export class RoleRegistrationError extends NonRecoverableErrorBase {
  readonly code = 'ROLE_REGISTRATION_FAILED';

  constructor(
    readonly roleId: string,
    readonly reason: string,
  ) {
    super(`Cannot register role "${roleId}": ${reason}`);
  }
}
