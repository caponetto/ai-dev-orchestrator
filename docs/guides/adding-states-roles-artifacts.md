# Adding States, Roles, and Artifacts

This guide lists the current code paths you need to touch when extending the built-in workflows. Most registries use exhaustive `Record<ArtifactType, ...>` or `Record<RoleId, ...>` types — the compiler will error if you add a new type/role to the enum but forget to update a registry.

## Add a New Artifact Type

1. Add the new artifact string to `ARTIFACT_TYPES` in `packages/schemas/src/artifacts/artifact-system.ts`. The compiler will immediately flag every exhaustive `Record<ArtifactType, ...>` that is missing the new key.
2. Add a new entry to `ARTIFACT_DESCRIPTORS` in `packages/artifacts/src/domain/artifact-system/artifact-descriptors.ts`. This is the **single source of truth** for artifact metadata — each entry specifies the content Zod schema (`contentSchema`), default owner roles (`defaultOwners`), and an optional dashboard producer label (`producerLabel`). The derived maps `ARTIFACT_SCHEMA_MAP` and `DEFAULT_OWNERSHIP_MAP` are computed automatically from this record.
3. Add a dependency edge in `DEFAULT_EDGES` in `packages/dependency-graph/src/infrastructure/default-dependency-graph.ts` if the artifact participates in rebuild or provenance logic.
4. If the artifact is a review type, add it to `REVIEW_ARTIFACT_TYPES` in `packages/artifacts/src/domain/artifact-system/constants.ts`. Similarly for `AGREEMENT_ARTIFACT_TYPES` or `VERDICT_ARTIFACT_TYPES`.
5. Add tests in the nearby `packages/artifacts/src/**/__tests__/` files.

## Add a New Role

1. Add the role ID string to `ROLE_IDS` in `packages/schemas/src/runner/role-system.ts`. The compiler will flag every `Record<RoleId, ...>` that is missing the new key.
2. Add a static role definition in `packages/config-templates/src/static/roles/<role>.yaml`.
3. Add the corresponding prompt template in `packages/config-templates/src/static/templates/<role>.md`.
4. If the role is a reviewer participating in agreements, add it to `REVIEWER_ARTIFACT_TYPE` and/or `AGREEMENT_PARTICIPANTS` in `packages/workflow/src/infrastructure/workflow-engine/action-dispatcher.ts`.
5. Confirm the generated `roles.yaml` output still validates through `packages/config-templates/src/generators/roles-generator.ts` and its tests.
6. If the role uses a new runner path or dispatch behavior, wire that support in `packages/cli/src/composition-root.ts` and the runner-system package.

## Add a New Workflow State

1. Update the workflow definition in `packages/config-templates/src/static/workflows/dev.yaml`, `pr-review.yaml`, or `task-breakdown.yaml`.
2. If the state depends on new guards or actions, update the schemas in `packages/schemas/src/workflow/`. Guard params use `artifactTypeSchema`/`roleIdSchema`/`agreementTypeSchema` so invalid references fail at parse time.
3. Implement runtime behavior in `packages/workflow/src/infrastructure/workflow-engine/`, usually `action-dispatcher.ts`, `guard-checker.ts`, `transition-evaluator.ts`, or `review-result-interpreter.ts`.
4. Update tests in `packages/workflow/src/infrastructure/workflow-engine/__tests__/` and `packages/workflow/src/infrastructure/workflow-dsl/__tests__/`.

## Common Follow-Through

After changing states, roles, or artifacts, also review:

- dashboard projections in `packages/dashboard-server/src/dashboard/`
- dashboard rendering in `packages/dashboard/src/`
- any generated defaults or validation paths in `packages/config-templates/src/`
- CLI behavior that surfaces the new state or artifact in `packages/cli/src/commands/`

## Type Safety

### Centralized Artifact Descriptor

The `ARTIFACT_DESCRIPTORS` record in `packages/artifacts/src/domain/artifact-system/artifact-descriptors.ts` is the single source of truth for artifact metadata. Adding a new `ArtifactType` to the enum without adding a corresponding descriptor entry will produce a compiler error. The following maps are derived from it automatically:

| Derived Map             | File                                                                                  | Description                           |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `ARTIFACT_SCHEMA_MAP`   | `packages/artifacts/src/domain/artifact-system/artifact-descriptors.ts`               | Content Zod schema per artifact type  |
| `DEFAULT_OWNERSHIP_MAP` | `packages/artifacts/src/infrastructure/artifact-system/default-ownership-registry.ts` | Default owner roles per artifact type |
| `DEFAULT_PRODUCER`      | `packages/cli/src/dashboard/data-sources.ts`                                          | Producer label for dashboard display  |

### Other Exhaustive Registries

| Registry               | File                                         | Key Type                      |
| ---------------------- | -------------------------------------------- | ----------------------------- |
| `KNOWN_ARTIFACT_TYPES` | `packages/cli/src/dashboard/data-sources.ts` | derived from `ARTIFACT_TYPES` |

### Partial Registries (type-checked keys, optional coverage)

| Registry                 | File                                                            | Key Type        |
| ------------------------ | --------------------------------------------------------------- | --------------- |
| `REVIEWER_ARTIFACT_TYPE` | `packages/workflow/.../action-dispatcher.ts`                    | `RoleId`        |
| `AGREEMENT_PARTICIPANTS` | `packages/workflow/.../action-dispatcher.ts`                    | `AgreementType` |
| `TYPE_RENDERERS`         | `packages/dashboard/src/components/artifact-renderers/index.ts` | `ArtifactType`  |
| `DEFAULT_ROLE_TRUST`     | `packages/runner/.../default-permission-policy.ts`              | `RoleId`        |

## Source of Truth

- `ARTIFACT_TYPES` array in `packages/schemas/src/artifacts/artifact-system.ts`
- `ARTIFACT_DESCRIPTORS` record in `packages/artifacts/src/domain/artifact-system/artifact-descriptors.ts`
- `ROLE_IDS` array in `packages/schemas/src/runner/role-system.ts`
- Workflow YAML files in `packages/config-templates/src/static/workflows/`
- Role YAML + template files in `packages/config-templates/src/static/roles/` and `templates/`
