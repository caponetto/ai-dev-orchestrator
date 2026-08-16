# AI Dev Orchestrator Docs

This directory documents the implementation that exists in the repository today. The code is the source of truth.

## Start Here

- `getting-started.md` for install, init, and day-to-day CLI usage
- `system-overview.md` for package boundaries, runtime layout, and workflow shape
- `subsystems/cli.md` for the command surface
- `subsystems/configuration.md` for `.ai/` files and runtime config assembly
- `subsystems/dashboard.md` for the local web UI and HTTP surface
- `subsystems/repository-model.md` for the on-disk runtime layout under `.ai/`
- `subsystems/workflow-engine.md` for built-in workflows and state progression
- `subsystems/runner-system.md` for agent dispatch, protocol transport, and sessions
- `subsystems/role-system.md` for role contracts and model assignment behavior
- `subsystems/governance.md` for iteration limits, quality gates, budget, and permission policy
- `guides/agent-adapter-guide.md` for implementing a protocol adapter
- `guides/adding-states-roles-artifacts.md` for extending the built-in workflow and role set
- `guides/adding-a-package.md` for adding a new workspace package to the monorepo
- `guides/adding-a-partial.md` for adding shared prompt fragments

## Documentation Scope

The repository used to contain many larger design-spec and example documents. Most of that material was removed because it duplicated the code, described unimplemented behavior, or had drifted beyond safe maintenance.

The remaining docs are the ones that are useful for operating, extending, or understanding the current repository.
