# CLI Subsystem

The CLI is implemented in `packages/cli/src/index.ts` and is the primary operator entry point.

## Responsibilities

- initialize the global `~/.ai/` configuration directory
- validate and display configuration
- start, resume, inspect, and abort runs
- answer approvals and clarification requests
- answer live permission requests
- launch the local dashboard

The CLI parses arguments, loads project configuration, wires the runtime in `composition-root.ts`, and formats output.

## Global Flags

The top-level command currently supports:

- `--json`
- `--verbose`
- `--no-color`

The `--repo <path>` flag is available on `run`, `resume`, and `retry` to specify the repository context.

## Implemented Commands

- `ai init [--force]`
- `ai run [sources...] [--dry-run] [--workflow <name>] [--source <refs...>] [--repo <path>]`
- `ai resume [runId] [--repo <path>]`
- `ai retry <runId> [--repo <path>]`
- `ai abort [runId] [--force]`
- `ai status [runId] [--watch] [--follow]`
- `ai list [--status <status>] [--limit <n>]`
- `ai inspect [runId]`
- `ai artifacts [runId] [--type <type>]`
- `ai validate`
- `ai config show`
- `ai dashboard [--port <number>] [--host <addr>] [--no-open]`
- `ai approve [runId] [--reject] [--message <text>]`
- `ai answer [runId] [answers...] [--input-file <path>] [--message-id <id>]`
- `ai permit [runId] [--deny] [--message-id <id>]`
- `ai kill`
- `ai version`

Dashboard defaults are:

- host: `127.0.0.1`
- API port: `9100`

## Model Availability Before a New Run

Before creating a run directory, `ai run` checks the effective model for every configured role
using its selected built-in runner (`claude-code`, `cursor`, `codex`, or `opencode`). The check
uses the same model precedence as dispatch: `agentConfig.model`, then the role model assignment.
The `agent` sentinel checks the runner's default model.

Each distinct runner/model pair sends a small inference request with the repository as its
configuration context. Checks run two at a time, with a 30-second timeout per request. They add
startup latency and may incur provider usage, including with `--dry-run`. A successful terminal
response is required; a model catalog entry or installed CLI alone is insufficient. Provider
errors, authentication failures, and timeouts block startup and report all affected models and
roles, without creating a run directory. Availability can still change after this check.

OpenCode checks require approval for all tools and omit `--auto`, so its non-interactive CLI
rejects tool permission requests. This preserves the tool definitions sent to the provider;
denying every tool instead can trigger OpenCode's free-tier rejection even inside the official CLI.

The dashboard performs the same check before spawning the run process and displays failures on
the New Run page. A configuration fingerprint and a receipt valid for 60 seconds let the child
process reuse that check. Changed settings or expired receipts trigger a new check.

Custom runners and roles that override the CLI command or arguments are not probed; the CLI
emits an explicit warning for these roles. Fixture mode skips provider checks. Resume and retry
continue to use their existing behavior.

## Human-in-the-Loop Model

The current implementation uses three operator response paths:

- `ai approve` for approval and rejection gates
- `ai answer` for clarification requests
- `ai permit` for live permission requests emitted by agent sessions

`ai resume` is separate. It resumes an interrupted run; it does not answer a pending request.

## Source of Truth

Prefer:

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/`
- `packages/cli/src/composition-root.ts`
