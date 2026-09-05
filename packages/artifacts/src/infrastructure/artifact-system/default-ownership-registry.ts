import type { OwnershipRegistry } from '@ai-dev-orchestrator/ports';
import type { ArtifactType, RoleContract } from '@ai-dev-orchestrator/schemas';
import { ARTIFACT_TYPES } from '@ai-dev-orchestrator/schemas';

import { ARTIFACT_DESCRIPTORS } from '../../domain/artifact-system/artifact-descriptors';

/**
 * Builds an ownership override map from role contracts by collecting each role's
 * declared `ownedArtifacts` into a map keyed by artifact type.
 */
export function buildOwnershipOverrides(
  roles: readonly RoleContract[],
): ReadonlyMap<ArtifactType, string[]> {
  const map = new Map<ArtifactType, string[]>();
  for (const role of roles) {
    for (const artifactType of role.ownedArtifacts) {
      const existing = map.get(artifactType);
      if (existing) {
        if (!existing.includes(role.id)) {
          existing.push(role.id);
        }
      } else {
        map.set(artifactType, [role.id]);
      }
    }
  }
  return map;
}

const DEFAULT_OWNERSHIP_MAP: Readonly<Record<ArtifactType, readonly string[]>> = Object.fromEntries(
  Object.entries(ARTIFACT_DESCRIPTORS).map(([k, v]) => [k, v.defaultOwners]),
) as Record<ArtifactType, readonly string[]>;

export class DefaultOwnershipRegistry implements OwnershipRegistry {
  private readonly ownershipMap: Readonly<Record<ArtifactType, readonly string[]>>;

  constructor(overrides?: ReadonlyMap<ArtifactType, string> | ReadonlyMap<ArtifactType, string[]>) {
    if (overrides) {
      const merged = { ...DEFAULT_OWNERSHIP_MAP } as Record<ArtifactType, readonly string[]>;
      for (const [type, owners] of overrides) {
        const existing = merged[type];
        const ownerList = Array.isArray(owners) ? owners : [owners];
        const newOwners = ownerList.filter((o) => !existing.includes(o));
        if (newOwners.length > 0) {
          merged[type] = [...existing, ...newOwners];
        }
      }
      this.ownershipMap = merged;
    } else {
      this.ownershipMap = DEFAULT_OWNERSHIP_MAP;
    }
  }

  getOwner(type: ArtifactType): string | null {
    const owners = this.ownershipMap[type];
    return owners[0] ?? null;
  }

  isAuthorized(role: string, type: ArtifactType): boolean {
    if (role === 'system') {
      return true;
    }
    const owners = this.ownershipMap[type];
    return owners.includes(role);
  }

  getOwnedTypes(role: string): ArtifactType[] {
    const types: ArtifactType[] = [];
    for (const artifactType of ARTIFACT_TYPES) {
      const owners = this.ownershipMap[artifactType];
      if (owners.includes(role)) {
        types.push(artifactType);
      }
    }
    return types;
  }
}
