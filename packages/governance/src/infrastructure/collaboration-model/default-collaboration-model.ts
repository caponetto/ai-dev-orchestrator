import type { CollaborationModel, RoleRegistry } from '@ai-orchestrator/ports';
import type {
  ArtifactFlowDefinition,
  ArtifactType,
  RoleId,
  RoleInteraction,
  VisibilityCheck,
} from '@ai-orchestrator/schemas';

/** Default implementation of the CollaborationModel port backed by RoleRegistry. */
export class DefaultCollaborationModel implements CollaborationModel {
  private readonly roleRegistry: RoleRegistry;

  constructor(roleRegistry: RoleRegistry) {
    this.roleRegistry = roleRegistry;
  }

  /** @inheritdoc */
  getInteractions(roleId: RoleId): readonly RoleInteraction[] {
    const role = this.roleRegistry.getRole(roleId);
    if (!role) {
      return [];
    }

    const interactions: RoleInteraction[] = [];

    for (const artifactType of role.ownedArtifacts) {
      const consumers = this.getConsumersFor(artifactType);
      for (const consumerId of consumers) {
        if (consumerId !== roleId) {
          interactions.push({
            producerRole: roleId,
            consumerRole: consumerId,
            artifactType,
            relationship: 'produces_for',
          });
        }
      }
    }

    for (const reviewedRoleId of role.reviews) {
      const reviewedRole = this.roleRegistry.getRole(reviewedRoleId);
      if (reviewedRole) {
        for (const artifactType of reviewedRole.ownedArtifacts) {
          interactions.push({
            producerRole: reviewedRoleId,
            consumerRole: roleId,
            artifactType,
            relationship: 'reviews',
          });
        }
      }
    }

    return interactions;
  }

  /** @inheritdoc */
  getFlowDefinitions(): readonly ArtifactFlowDefinition[] {
    const roles = this.roleRegistry.listRoles();
    const flows: ArtifactFlowDefinition[] = [];

    for (const role of roles) {
      for (const artifactType of role.ownedArtifacts) {
        const consumedBy = this.getConsumersFor(artifactType).filter((id) => id !== role.id);
        const reviewedBy = role.reviewedBy.slice();

        flows.push({
          artifactType,
          producedBy: role.id,
          consumedBy,
          reviewedBy,
        });
      }
    }

    return flows;
  }

  /** @inheritdoc */
  checkVisibility(roleId: RoleId, artifactType: ArtifactType): VisibilityCheck {
    const role = this.roleRegistry.getRole(roleId);
    if (!role) {
      return { allowed: false, reason: `Role "${roleId}" not found` };
    }

    if (role.forbiddenArtifacts.includes(artifactType)) {
      return {
        allowed: false,
        reason: `Role "${roleId}" is forbidden from accessing "${artifactType}"`,
      };
    }

    if (role.ownedArtifacts.includes(artifactType)) {
      return { allowed: true, reason: `Role "${roleId}" owns "${artifactType}"` };
    }

    if (role.readableArtifacts.includes(artifactType)) {
      return { allowed: true, reason: `Role "${roleId}" has read access to "${artifactType}"` };
    }

    return { allowed: false, reason: `Role "${roleId}" has no access to "${artifactType}"` };
  }

  /** @inheritdoc */
  getProducerFor(artifactType: ArtifactType): string | null {
    const roles = this.roleRegistry.listRoles();
    for (const role of roles) {
      if (role.ownedArtifacts.includes(artifactType)) {
        return role.id;
      }
    }
    return null;
  }

  /** @inheritdoc */
  getConsumersFor(artifactType: ArtifactType): readonly string[] {
    const roles = this.roleRegistry.listRoles();
    const consumers: string[] = [];
    for (const role of roles) {
      if (role.readableArtifacts.includes(artifactType)) {
        consumers.push(role.id);
      }
    }
    return consumers;
  }

  /** @inheritdoc */
  getReviewersFor(roleId: RoleId): readonly string[] {
    const role = this.roleRegistry.getRole(roleId);
    if (!role) {
      return [];
    }
    return [...role.reviewedBy];
  }
}
