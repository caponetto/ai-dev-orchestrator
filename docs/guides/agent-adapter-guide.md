# Agent Adapter Guide

This guide covers the current extension surface for connecting an external agent to the runner system.

## When This Guide Applies

Use this guide if you need to add or adjust a runner-side adapter that translates between an agent's native I/O and the orchestrator protocol.

The relevant code lives across three packages:

- `packages/agent-protocol/` — structured protocol message types
- `packages/agent-adapters/` — adapter implementations and capability probes
- `packages/runner/src/infrastructure/runner-system/` — transport and session infrastructure

## Core Interfaces

The structured protocol types live in:

- `packages/agent-protocol/src/agent-protocol-types.ts`

Adapter implementations and capability probes live in:

- `packages/agent-adapters/src/`

Transport implementations live in:

- `packages/runner/src/infrastructure/runner-system/stdio-protocol-transport.ts`
- `packages/runner/src/infrastructure/runner-system/websocket-protocol-transport.ts`

The current adapter model is centered on translating input and output for an `AgentRunner` implementation rather than baking one agent format into the workflow engine.

## Practical Steps

1. Add or update an adapter under `packages/agent-adapters/src/`.
2. If the agent needs transport-specific support, implement or extend the relevant transport glue in `packages/runner/src/infrastructure/runner-system/`.
3. If the agent can expose structured protocol behavior, model that behavior with the types in `packages/agent-protocol/src/agent-protocol-types.ts`.
4. Add or update capability probing if the runner must detect supported modes at startup.
5. Wire the runner in `packages/cli/src/composition-root.ts`.
6. Add tests for translation, probing, request routing, and session behavior where applicable.

## Capability Probing

The CLI currently probes local runner capabilities before registering runtime runners. Existing examples include the Claude Code and Cursor probes in `packages/agent-adapters/src/` and the runner wiring in `packages/cli/src/composition-root.ts`.

If a new adapter needs multiple modes, prefer a capability probe plus explicit mode normalization instead of hardcoding assumptions.

## Live Requests and Sessions

If the adapter supports permission requests, clarification requests, or resumable sessions, verify it against:

- `file-backed-live-request-store.ts`
- `default-agent-session-store.ts`
- `local-agent-session-supervisor.ts`
- `remote-agent-session-supervisor.ts`

Those files define the current persisted request and session behavior that the CLI and dashboard depend on.

## Source of Truth

Prefer:

- `packages/agent-protocol/src/agent-protocol-types.ts`
- `packages/agent-adapters/src/`
- `packages/runner/src/infrastructure/runner-system/`
- `packages/cli/src/composition-root.ts`
