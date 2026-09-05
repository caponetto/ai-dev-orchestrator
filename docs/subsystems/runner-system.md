# Runner System

The runner system lives under `packages/runner/src/infrastructure/runner-system/`.

## Responsibilities

The current runner system:

- assembles agent tasks from workflow state, role contract, and artifacts
- dispatches work through registered runner adapters
- handles streaming output and protocol messages
- routes live permission and clarification requests
- records session state for resumable agents
- returns dispatch results back to the workflow engine

The workflow engine decides when to dispatch. The runner system decides how to execute that dispatch.

## Current Dispatch Model

The current code supports:

- CLI-backed runners
- HTTP-backed runners
- single-worker dispatch
- parallel worker dispatch
- structured protocol transport for capable agents
- file-backed live request and live response exchange

The CLI composition root probes supported local environments and currently wires built-in runner entries for `claude-code`, `cursor`, and `codex` when available. The Codex runner invokes `codex exec --json --sandbox workspace-write` with `-c sandbox_workspace_write.network_access=true`, forwarding the configured role model through the CLI's `--model` option. Network access is required for PR-review workflows that call `gh pr view`, `gh pr diff`, and similar GitHub API commands; without it, Codex's workspace-write sandbox blocks outbound connections to `api.github.com` even when `gh` is authenticated on the host. It records the completed turn's input and output token usage. Codex does not speak the orchestrator handshake protocol, so the CLI runner uses `stdin: ignore` (prompt is passed via argv; avoids Codex logging "Reading additional input from stdin..." to stderr) and dispatches directly instead of negotiating a resumable session first. Codex also receives `--add-dir ~/.ai` so artifact writes under the orchestrator run directory are permitted alongside the checked-out repository workspace.

Codex approval prompts are bridged to the orchestrator dashboard through a Codex `PermissionRequest` hook. Before each Codex dispatch, the runner writes a per-run hook launcher under `.ai/runs/<run-id>/` and passes a `-c hooks.PermissionRequest=...` override plus `--dangerously-bypass-hook-trust`. The hook invokes `ai codex-permission-hook`, which maps Codex approval requests into the same `DefaultPermissionPolicy` and `FileBackedLiveRequestStore` flow used by Claude Code and Cursor. Writes under `~/.ai/` are auto-granted; other operations surface as dashboard permission prompts.

## Protocol and Sessions

Protocol-capable runners can use the structured agent protocol types in `packages/agent-protocol/src/agent-protocol-types.ts`. Runner adapters (Claude Code, Cursor, Codex, gh-cli) live in `packages/agent-adapters/src/`.

The session model currently includes:

- `DefaultAgentSessionStore` for persisted snapshots under `.ai/runs/<run-id>/sessions/`
- `LocalAgentSessionSupervisor` for stdio-backed local sessions
- `RemoteAgentSessionSupervisor` for reconnectable remote sessions
- `CompositeAgentSessionSupervisor` for unified session handling

Live requests are stored under `.ai/runs/<run-id>/live-requests/` and responses under `.ai/runs/<run-id>/live-responses/`.

## Key Implementation Files

See `packages/runner/src/infrastructure/runner-system/` for the full set. Core files include:

- `default-runner-system.ts` — orchestrates dispatch, streaming, and result handling
- `agent-task-assembler.ts` — builds agent tasks from workflow state and role contracts
- `runner-context-assembler.ts` — assembles runtime context for dispatch
- `cli-agent-runner.ts` — CLI-backed runner adapter
- `codex-permission-hook.ts` — Codex PermissionRequest hook bridge to dashboard live requests
- `http-agent-runner.ts` — HTTP-backed runner adapter
- `parallel-manager.ts` — parallel worker dispatch coordination
- `worker-spawner.ts` — worker lifecycle management
- `file-backed-live-request-store.ts` — persisted live request exchange
- `default-agent-session-store.ts` — session snapshot persistence
- `local-agent-session-supervisor.ts` — stdio-backed local sessions
- `remote-agent-session-supervisor.ts` — reconnectable remote sessions
- `composite-agent-session-supervisor.ts` — unified session handling

## Source of Truth

Prefer:

- `packages/runner/src/infrastructure/runner-system/`
- `packages/agent-protocol/src/agent-protocol-types.ts`
- `packages/agent-adapters/src/`
- `packages/cli/src/composition-root.ts`
