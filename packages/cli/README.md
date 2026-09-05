# @ai-dev-orchestrator/cli

The `ai` command-line interface. This is the composition root that wires together every workspace package into a single executable, built with Commander.js and bundled with esbuild.

## Architecture Layer

**Composition** -- the outermost layer that assembles all adapters, services, and infrastructure into a runnable application.

## Workspace Dependencies

- `@ai-dev-orchestrator/agent-adapters`
- `@ai-dev-orchestrator/artifacts`
- `@ai-dev-orchestrator/config-templates`
- `@ai-dev-orchestrator/core`
- `@ai-dev-orchestrator/dashboard-server`
- `@ai-dev-orchestrator/dependency-graph`
- `@ai-dev-orchestrator/governance`
- `@ai-dev-orchestrator/journal`
- `@ai-dev-orchestrator/policy-engine`
- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/prompt-engine`
- `@ai-dev-orchestrator/recovery`
- `@ai-dev-orchestrator/role-system`
- `@ai-dev-orchestrator/run-manifest`
- `@ai-dev-orchestrator/runner`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`
- `@ai-dev-orchestrator/workflow`
- `@ai-dev-orchestrator/project-context`

## Structure

```
src/
  commands/
  dashboard/
  output/
```

## Entry Point

The binary is registered as `ai` in package.json. Commands available:

`abort`, `answer`, `approve`, `artifacts`, `config-show`, `dashboard`, `find-run`, `init`, `inspect`, `kill`, `list`, `permit`, `resume`, `retry`, `run`, `status`, `validate`, `version`

Each command lives in its own file under `src/commands/`. The `src/output/` module handles terminal formatting and the `src/dashboard/` module manages the embedded dashboard server lifecycle.
