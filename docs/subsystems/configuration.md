# Configuration System

The configuration loader is implemented in `packages/core/src/infrastructure/configuration/configuration-loader.ts`.

## Required Runtime Files

The runtime requires the global `~/.ai/` directory with these files:

- `config.yaml`
- `roles.yaml`
- `governance.yaml`

`ai init` also generates `runners.yaml` and `templates/`, but those are not part of `REQUIRED_CONFIG_FILES`.

## Load Pipeline

The current loader does this:

1. checks that the required files exist
2. parses YAML from those files
3. converts snake_case keys to camelCase
4. resolves `${ENV_VAR}` references
5. assembles a merged runtime object
6. validates it against schema
7. deep-freezes the result

## Effective Runtime Shape

The assembled runtime object has four top-level sections:

- `workflow`
- `roles`
- `governance`
- `runtime`

The main schema lives in `packages/schemas/src/config/configuration.ts`.

## `config.yaml`

The loader currently reads:

- `default_workflow`
- `workflow_version`
- `global_transition_limit`
- `log_level`
- `report_output_path`

`default_workflow` selects the built-in workflow name. Current built-in names are `dev`, `pr-review`, and `task-breakdown`.

## `roles.yaml`

The generated file is a `roles:` array. For runtime configuration assembly, the loader extracts only the fields that affect dispatch and model selection:

- `model`
- `max_tokens`
- `dispatch_type`
- `runner`
- `agent_config`

Role contracts themselves are also loaded separately by the runner role system from the same file.

### Role contract validation

At startup, the contract validator (`packages/role-system/src/infrastructure/contract-validator.ts`) enforces:

- **Ownership uniqueness** — artifact types should not be owned by multiple roles (warning)
- **Forbidden disjointness** — `readable_artifacts` and `forbidden_artifacts` must be fully disjoint (error); `owned_artifacts` and `forbidden_artifacts` must not overlap (error)
- **Review reciprocity** — `reviewedBy` and `reviews` must be consistent across roles (warning)
- **Circular review detection** — review chains must be acyclic (error)
- **Readable artifact reachability** — readable artifacts should be produced by at least one role (warning)

A validation failure prevents the run from starting and surfaces as exit code 2 (`CONFIGURATION_ERROR`).

## `governance.yaml`

The current assembled config uses:

- `iteration_limits`
- `quality_gates`
- `budget`
- `permission_policy`

`permission_policy` is authored in `governance.yaml`, but the configuration loader maps it into `roles.permissionPolicy` in the merged runtime config because the runner system consumes it there.

## Defaults and Generated Config

When a project has no `.ai/` config yet, `packages/cli/src/project-config.ts` can fall back to generated defaults from `@ai-orchestrator/config-templates` for validation and workflow loading paths.

## Source of Truth

Prefer:

- `packages/core/src/infrastructure/configuration/configuration-loader.ts`
- `packages/schemas/src/config/configuration.ts`
- `packages/cli/src/project-config.ts`
- `packages/cli/src/composition-root.ts`
