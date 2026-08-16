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
