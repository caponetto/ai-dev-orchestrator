# Role System

The role system lives under `packages/role-system/src/`.

## What a Role Represents

A role is the contract used by the orchestrator to describe a worker's responsibilities and boundaries. The current role documents include:

- identity fields such as `id`, `name`, and `description`
- artifact permissions such as `owned_artifacts`, `readable_artifacts`, and `forbidden_artifacts`
- review relationships such as `reviewed_by` and `reviews`
- agreement participation
- required capabilities
- dispatch metadata such as `runner`, `agent_config`, and `dispatch_type`

Role documents are authored in `.ai/roles.yaml` for a project, or generated from the built-in static role definitions in `packages/config-templates/src/static/roles/`.

## Current Loading Behavior

The runner role system loads full role contracts from `roles.yaml` through `loadRolesFromFile()` or generated defaults through `loadRolesFromYaml(generateRolesYaml())`.

At runtime, `DefaultRoleRegistry` combines:

- role contracts from the role loader
- per-role model assignment overrides from merged configuration
- dispatch overrides such as `runner` and `agentConfig`

If no explicit model override is available, the CLI composition root falls back to the first model from the built-in runner registry.

## Source of Truth

Prefer:

- `packages/role-system/src/infrastructure/role-file-loader.ts`
- `packages/role-system/src/infrastructure/role-registry.ts`
- `packages/config-templates/src/static/roles/`
- `packages/config-templates/src/generators/roles-generator.ts`
- `packages/cli/src/composition-root.ts`
