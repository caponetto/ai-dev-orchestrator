import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef, ArtifactType } from '@ai-dev-orchestrator/schemas';

/** Thrown when a role attempts to produce an artifact type it does not own. */
export class OwnershipViolationError extends NonRecoverableErrorBase {
  readonly code = 'OWNERSHIP_VIOLATION';

  constructor(
    readonly role: string,
    readonly artifactType: ArtifactType,
    readonly ownerRole: string,
  ) {
    super(`Role "${role}" cannot produce artifact type "${artifactType}"; owner is "${ownerRole}"`);
  }
}

/** Thrown when an attempt is made to overwrite an existing artifact version. */
export class ImmutabilityViolationError extends NonRecoverableErrorBase {
  readonly code = 'IMMUTABILITY_VIOLATION';

  constructor(readonly ref: ArtifactRef) {
    super(
      `Cannot overwrite artifact ${ref.type}/${ref.name} v${String(ref.version)}: artifacts are immutable`,
    );
  }
}

/** Thrown when a stored artifact's content does not match its checksum. */
export class ChecksumMismatchError extends NonRecoverableErrorBase {
  readonly code = 'CHECKSUM_MISMATCH';

  constructor(
    readonly ref: ArtifactRef,
    readonly expectedChecksum: string,
    readonly actualChecksum: string,
  ) {
    super(
      `Checksum mismatch for ${ref.type}/${ref.name} v${String(ref.version)}: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  }
}

/** Thrown when a requested artifact cannot be found on disk. */
export class ArtifactNotFoundError extends NonRecoverableErrorBase {
  readonly code = 'ARTIFACT_NOT_FOUND';

  constructor(readonly ref: ArtifactRef) {
    super(`Artifact not found: ${ref.type}/${ref.name} v${String(ref.version)}`);
  }
}

/** Thrown when artifact content fails type schema validation. */
export class TypeValidationError extends NonRecoverableErrorBase {
  readonly code = 'TYPE_VALIDATION_ERROR';

  constructor(
    readonly artifactType: ArtifactType,
    readonly validationErrors: readonly { readonly path: string; readonly message: string }[],
  ) {
    const details = validationErrors.map((e) => `${e.path}: ${e.message}`).join('; ');
    super(`Type validation failed for "${artifactType}": ${details}`);
  }
}

/** Thrown when the inventory file is inconsistent with artifacts on disk. */
export class InventoryCorruptionError extends NonRecoverableErrorBase {
  readonly code = 'INVENTORY_CORRUPTION';

  constructor(message: string) {
    super(`Inventory corruption: ${message}`);
  }
}

/** Thrown when a filesystem write operation fails. */
export class DiskWriteError extends NonRecoverableErrorBase {
  readonly code = 'DISK_WRITE_ERROR';

  constructor(
    readonly filePath: string,
    readonly cause: string,
  ) {
    super(`Disk write failed at ${filePath}: ${cause}`);
  }
}
