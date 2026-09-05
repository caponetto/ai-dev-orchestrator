# @ai-orchestrator/cli

The `ai` command-line interface. This is the composition root that wires together every workspace package into a single executable, built with Commander.js and bundled with esbuild.

## Architecture Layer

**Composition** -- the outermost layer that assembles all adapters, services, and infrastructure into a runnable application.

## Workspace Dependencies

- `@ai-orchestrator/agent-adapters`
- `@ai-orchestrator/artifacts`
- `@ai-orchestrator/config-templates`
- `@ai-orchestrator/core`
- `@ai-orchestrator/dashboard-server`
- `@ai-orchestrator/dependency-graph`
- `@ai-orchestrator/governance`
- `@ai-orchestrator/journal`
- `@ai-orchestrator/policy-engine`
- `@ai-orchestrator/ports`
- `@ai-orchestrator/prompt-engine`
- `@ai-orchestrator/recovery`
- `@ai-orchestrator/role-system`
- `@ai-orchestrator/run-manifest`
- `@ai-orchestrator/runner`
- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`
- `@ai-orchestrator/workflow`
- `@ai-orchestrator/project-context`

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
