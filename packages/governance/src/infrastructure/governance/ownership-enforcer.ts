import type { OwnershipRegistry } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';

import type { OwnershipCheckResult } from '../../domain/governance/ownership-check-result';

export type { OwnershipCheckResult };

/** Enforces artifact ownership rules within governance decisions. */
export class OwnershipEnforcer {
  private readonly ownershipRegistry: OwnershipRegistry;

  /** Create a new OwnershipEnforcer with the given registry. */
  constructor(ownershipRegistry: OwnershipRegistry) {
    this.ownershipRegistry = ownershipRegistry;
  }

  /** Check if a role is allowed to produce/modify a given artifact. */
  checkWriteAccess(roleId: string, artifactRef: ArtifactRef): OwnershipCheckResult {
    const authorized = this.ownershipRegistry.isAuthorized(roleId, artifactRef.type);

    if (authorized) {
      return {
        allowed: true,
        reason: `Role "${roleId}" is authorized to produce "${artifactRef.type}"`,
      };
    }

    const owner = this.ownershipRegistry.getOwner(artifactRef.type);
    if (!owner) {
      return {
        allowed: true,
        reason: `No ownership constraint for artifact type "${artifactRef.type}"`,
      };
    }

    return {
      allowed: false,
      reason: `Role "${roleId}" cannot write to "${artifactRef.type}" — owned by "${owner}"`,
    };
  }

  /** Check if a role is allowed to read a given artifact (owners always can). */
  checkReadAccess(roleId: string, artifactRef: ArtifactRef): OwnershipCheckResult {
    const owner = this.ownershipRegistry.getOwner(artifactRef.type);

    if (!owner) {
      return { allowed: true, reason: `No ownership constraint for "${artifactRef.type}"` };
    }

    if (owner === roleId) {
      return {
        allowed: true,
        reason: `Role "${roleId}" owns "${artifactRef.type}" (implicit read)`,
      };
    }

    return { allowed: true, reason: `Read access to "${artifactRef.type}" granted by default` };
  }

  /** Validate all artifacts in a transition request against ownership rules. */
  validateTransitionArtifacts(
    roleId: string,
    artifacts: readonly ArtifactRef[],
    isProducing: boolean,
  ): OwnershipCheckResult {
    for (const artifact of artifacts) {
      const check = isProducing
        ? this.checkWriteAccess(roleId, artifact)
        : this.checkReadAccess(roleId, artifact);

      if (!check.allowed) {
        return check;
      }
    }

    return { allowed: true, reason: 'All artifact ownership checks passed' };
  }
}
