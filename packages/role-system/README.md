# @ai-dev-orchestrator/role-system

Role registry, model assignment, and contract validation for agent roles. Manages which AI models are assigned to which roles, enforces visibility and ownership rules, and loads role definitions from YAML configuration.

## Architecture Layer

**Domain** -- defines the role abstractions and assignment rules that higher layers depend on.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Key Exports

### Domain (Errors)

- `CircularReviewError`
- `ModelAssignmentError`
- `OwnershipConflictError`
- `PermissionDeniedError`
- `RoleNotFoundError`
- `RoleRegistrationError`
- `VisibilityViolationError`

### Infrastructure

- `DefaultRoleRegistry` -- role registration and lookup
- `ModelAssigner` -- assigns models to roles based on configuration
- `loadRolesFromFile`, `loadRolesFromYaml` -- role definition loaders
- `validateContracts` -- validates role contract constraints

### Types

- `DispatchOverride`, `ModelAssignmentConfig`
