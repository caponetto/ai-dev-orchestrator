# Getting Started

This guide reflects the current implementation in `packages/cli`, `packages/core`, `packages/workflow`, `packages/runner`, `packages/governance`, `packages/artifacts`, `packages/dashboard-server`, and `packages/dashboard`.

## Prerequisites

- Node.js 22 or later
- pnpm 11 or later
- At least one supported local runner environment that the CLI can probe successfully, currently `claude-code`, `cursor`, `codex`, or `gh-cli`

## Build the Monorepo

```bash
git clone <repository-url>
cd ai-dev-orchestrator
pnpm install
pnpm build:prod
```

After the build, you can either:

- run the CLI from the workspace with `pnpm --filter @ai-orchestrator/cli exec ai --help`
- or install the local package globally with `pnpm link:cli`

## Initialize Configuration

Run `ai init` to create the global configuration directory:

```bash
ai init
```

That creates a `~/.ai/` directory. The generated files include:

```text
~/.ai/
  config.yaml
  roles.yaml
  governance.yaml
  runners.yaml
  templates/
    <role-id>.md
  scripts/
  ui-profiles/
  runs/
```

Notes:

- `config.yaml`, `roles.yaml`, and `governance.yaml` are the required runtime config files.
- `runners.yaml` is generated from the built-in runner registry that ships with the repository.
- To use the `codex` runner, install the Codex CLI and authenticate it with `codex login`. Codex executes tasks with workspace-write sandboxing, enables outbound network access for tools like `gh`, and reports token usage from its JSONL completion event.
- `templates/` contains per-role prompt templates that can be overridden per project.
- `runs/` stores per-run state, artifacts, journals, manifests, reports, session snapshots, and live request files.

## Validate Configuration

```bash
ai validate
ai config show
```

`ai validate` runs the same configuration loading and schema validation path used at runtime. `ai config show` prints the effective merged configuration that the CLI will use.

## Start a Run

```bash
ai run "Add a /health endpoint that returns 200 OK"
ai run --source jira:PROJ-123
ai run --workflow pr-review --source github:owner/repo#42
ai run --dry-run "Validate config only"
```

Current built-in workflows are `dev`, `pr-review`, and `task-breakdown`.

## Inspect Runs

```bash
ai status
ai status --watch
ai list --limit 20
ai inspect <run-id>
ai artifacts <run-id>
ai artifacts <run-id> --type plan
```

## Human-in-the-Loop Commands

```bash
ai approve <run-id>
ai approve <run-id> --reject --message "Needs a narrower scope"
ai answer <run-id> "Use the existing auth middleware"
ai answer <run-id> --input-file answers.md
ai answer <run-id> --message-id <message-id> "Use PostgreSQL"
ai permit <run-id>
ai permit <run-id> --deny --message-id <message-id>
ai resume <run-id>
ai abort <run-id>
```

Use:

- `ai approve` for approval and rejection gates
- `ai answer` for clarification requests
- `ai permit` for live permission requests emitted by agent sessions
- `ai resume` for interrupted runs

## Dashboard

Launch the local dashboard with:

```bash
ai dashboard
ai dashboard --port 4000 --host 0.0.0.0 --no-open
```

The CLI API server defaults to `127.0.0.1:9100`. The dashboard frontend is started separately by the command and normally serves through Vite on its local dev URL.

## Next Docs

- `system-overview.md`
- `subsystems/cli.md`
- `subsystems/configuration.md`
- `subsystems/dashboard.md`
