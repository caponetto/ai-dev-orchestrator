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

The CLI composition root probes supported local environments and currently wires built-in runner entries for `claude-code` and `cursor` when available.

## Protocol and Sessions

Protocol-capable runners can use the structured agent protocol types in `packages/agent-protocol/src/agent-protocol-types.ts`. Runner adapters (Claude Code, Cursor, gh-cli) live in `packages/agent-adapters/src/`.

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
