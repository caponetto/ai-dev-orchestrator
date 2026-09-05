import type {
  ArtifactType,
  RoleContract,
  RoleId,
  RoleValidationError,
  RoleValidationResult,
  RoleValidationWarning,
} from '@ai-dev-orchestrator/schemas';
export function validateContracts(roles: readonly RoleContract[]): RoleValidationResult {
  const errors: RoleValidationError[] = [];
  const warnings: RoleValidationWarning[] = [];

  checkOwnershipUniqueness(roles, errors, warnings);
  checkForbiddenDisjointness(roles, errors);
  checkReviewReciprocity(roles, errors, warnings);
  checkCircularReviews(roles, errors);
  checkReadableArtifactsProduced(roles, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function checkOwnershipUniqueness(
  roles: readonly RoleContract[],
  _errors: RoleValidationError[],
  warnings: RoleValidationWarning[],
): void {
  const ownerMap = new Map<ArtifactType, string>();
  for (const role of roles) {
    for (const type of role.ownedArtifacts) {
      const existing = ownerMap.get(type);
      if (existing !== undefined && existing !== role.id) {
        warnings.push({
          roleId: role.id,
          message: `Artifact type "${type}" is also owned by "${existing}" — shared ownership`,
        });
      } else {
        ownerMap.set(type, role.id);
      }
    }
  }
}

function checkForbiddenDisjointness(
  roles: readonly RoleContract[],
  errors: RoleValidationError[],
): void {
  for (const role of roles) {
    for (const type of role.forbiddenArtifacts) {
      if (role.ownedArtifacts.includes(type)) {
        errors.push({
          roleId: role.id,
          field: 'forbiddenArtifacts',
          message: `Artifact type "${type}" is both owned and forbidden`,
        });
      }
      if (role.readableArtifacts.includes(type)) {
        errors.push({
          roleId: role.id,
          field: 'forbiddenArtifacts',
          message: `Artifact type "${type}" is both readable and forbidden`,
        });
      }
    }
  }
}

function checkReviewReciprocity(
  roles: readonly RoleContract[],
  errors: RoleValidationError[],
  warnings: RoleValidationWarning[],
): void {
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  for (const role of roles) {
    for (const reviewedByRole of role.reviewedBy) {
      const reviewer = roleMap.get(reviewedByRole);
      if (!reviewer) {
        errors.push({
          roleId: role.id,
          field: 'reviewedBy',
          message: `References unknown role "${reviewedByRole}"`,
        });
        continue;
      }
      if (!reviewer.reviews.includes(role.id)) {
        warnings.push({
          roleId: role.id,
          message: `Role "${reviewedByRole}" is listed in reviewedBy but does not list "${role.id}" in its reviews`,
        });
      }
    }

    for (const reviewsRole of role.reviews) {
      const reviewed = roleMap.get(reviewsRole);
      if (!reviewed) {
        errors.push({
          roleId: role.id,
          field: 'reviews',
          message: `References unknown role "${reviewsRole}"`,
        });
        continue;
      }
      if (!reviewed.reviewedBy.includes(role.id)) {
        warnings.push({
          roleId: role.id,
          message: `Role "${role.id}" reviews "${reviewsRole}" but is not listed in its reviewedBy`,
        });
      }
    }
  }
}

function checkCircularReviews(roles: readonly RoleContract[], errors: RoleValidationError[]): void {
  const roleMap = new Map(roles.map((r) => [r.id, r]));

  for (const role of roles) {
    const visited = new Set<RoleId>();
    const chain: RoleId[] = [role.id];

    function dfs(currentId: RoleId): boolean {
      if (visited.has(currentId)) {
        return false;
      }
      visited.add(currentId);

      const current = roleMap.get(currentId);
      if (!current) {
        return false;
      }

      for (const reviewedId of current.reviews) {
        if (reviewedId === role.id) {
          chain.push(reviewedId);
          errors.push({
            roleId: role.id,
            field: 'reviews',
            message: `Circular review chain: ${chain.join(' → ')}`,
          });
          chain.pop();
          return true;
        }
        chain.push(reviewedId);
        if (dfs(reviewedId)) {
          return true;
        }
        chain.pop();
      }

      return false;
    }

    dfs(role.id);
  }
}

function checkReadableArtifactsProduced(
  roles: readonly RoleContract[],
  warnings: RoleValidationWarning[],
): void {
  const allOwned = new Set<ArtifactType>();
  for (const role of roles) {
    for (const type of role.ownedArtifacts) {
      allOwned.add(type);
    }
  }

  for (const role of roles) {
    for (const type of role.readableArtifacts) {
      if (!allOwned.has(type) && type !== 'clarification_answers') {
        warnings.push({
          roleId: role.id,
          message: `Readable artifact type "${type}" is not owned by any role`,
        });
      }
    }
  }
}
