# Agent Adapter Guide

This guide covers the end-to-end extension surface for connecting an external agent CLI to the orchestrator runner system.

## When This Guide Applies

Use this guide if you need to add or adjust a runner-side adapter that translates between an agent CLI's native I/O (such as stream-json / JSONL) and the orchestrator protocol, registers the runner for role dispatch, and surfaces its health check in the dashboard.

The relevant code spans several packages:

- `packages/schemas/` — stable built-in runner IDs and types
- `packages/agent-protocol/` — structured protocol message types
- `packages/agent-adapters/` — adapter implementations, event types, and capability probes
- `packages/runner/` — subprocess invocation, stdin/prompt strategy, and token usage extraction
- `packages/cli/` — runtime runner registration and dashboard health probes
- `packages/config-templates/` — static runner registry and default model roster
- `packages/dashboard/` — UI display labels on health and config views

## Core Interfaces

The structured protocol types live in:

- `packages/agent-protocol/src/agent-protocol-types.ts`

Adapter implementations and capability probes live in:

- `packages/agent-adapters/src/`

Transport and execution implementations live in:

- `packages/runner/src/infrastructure/runner-system/cli-agent-runner.ts`
- `packages/runner/src/infrastructure/runner-system/stdio-protocol-transport.ts`
- `packages/runner/src/infrastructure/runner-system/websocket-protocol-transport.ts`

The adapter architecture translates input and output for an `AgentRunner` implementation rather than baking vendor-specific formats into the workflow engine.

## Step-by-Step Implementation Checklist

### 1. Register Built-in Runner ID (`packages/schemas`)

- Add the identifier to `BUILT_IN_CODING_RUNNER_ID` and `BUILT_IN_CODING_RUNNER_IDS` in `packages/schemas/src/runner/built-in-runner-ids.ts`.
- Update `packages/schemas/src/runner/__tests__/built-in-runner-ids.test.ts`.

### 2. Implement Event Types, Adapter & Probe (`packages/agent-adapters`)

- **Event Types & Parsers** (`src/external-event-types.ts`):
  - Declare discriminated union types for vendor stream events (e.g., text, tool calls, step finishes, errors).
  - Define vendor token usage shapes and include them in `VendorTokenUsage`.
  - Export a parse helper (e.g. `parseOpenCodeEvent(line: string)`).
- **Adapter** (`src/<name>-cli-adapter.ts`):
  - Implement the `AgentAdapter` interface.
  - Set `name = BUILT_IN_CODING_RUNNER_ID.<NAME>`, default command, and CLI arguments (e.g., non-interactive flags, stream format).
  - Set `supportsProtocolHandshake = false` if the CLI is prompt/CLI-driven rather than an interactive orchestrator-protocol agent.
  - Implement `translateOutput(line: string): ProtocolMessage | null` mapping vendor events into `progress`, `done`, or `error` messages.
- **Capability Probe** (`src/<name>-cli-capability-probe.ts`):
  - Implement `probe<Name>CliCapabilities(options)`: checks `--version`, verifies `--help` flags (e.g. JSON format, model options), and tests auth or model availability.
  - Implement `normalize<Name>ProbeResult(result)`: returns standardized mode (`'streaming' | 'text-only' | 'unauthenticated' | 'unavailable'`) and user-facing summary.
- **Barrel Exports** (`src/index.ts`):
  - Export adapter, capability probe, normalization function, and event types.

### 3. Wire Subprocess & Token Usage in Runner (`packages/runner`)

- In `packages/runner/src/infrastructure/runner-system/cli-agent-runner.ts`:
  - Add the runner ID to `PROMPT_BASED_ADAPTERS` if the CLI accepts the prompt as an argument.
  - Configure `stdin` handling in `resolveCliSubprocessStdinOption` (e.g. `'ignore'` to prevent CLI from waiting on stdin).
  - Add vendor usage shape detection and parse logic to `parseVendorUsage`.
  - Wire the event parser in `extractUsageFromRawLine(line)` to extract input/output tokens per step or on final completion.

### 4. Wire Runner in CLI (`packages/cli`)

- **Runtime Registration** (`packages/cli/src/composition-root.ts`):
  - Probe capabilities in `createRunnerRegistry()`.
  - If available, instantiate `CliAgentRunner` with the adapter and register via `registry.set(BUILT_IN_CODING_RUNNER_ID.<NAME>, runner)`.
- **Health Page Probes** (`packages/cli/src/commands/dashboard.ts`):
  - Probe capabilities in `dashboardCommand()` and append a `RunnerHealthEntry` with `status: 'healthy' | 'degraded' | 'unhealthy'`.

### 5. Add Static Runner Config & Models (`packages/config-templates`)

- Add the runner ID, display name, and supported default models to `packages/config-templates/src/static/runners.yaml`.

### 6. Update Dashboard Labels (`packages/dashboard`)

- Add friendly display names to:
  - `subsystemDisplayNames` in `packages/dashboard/src/pages/HealthPage.tsx` (`runner:<id>`).
  - `RUNNER_LABELS` in `packages/dashboard/src/components/ConfigPanel.tsx`.

### 7. Documentation

- Update references in `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/getting-started.md`, `docs/subsystems/runner-system.md`, and `packages/agent-adapters/README.md`.

## Capability Probing

The CLI probes local runner capabilities before registering runtime runners. Existing examples include:

- **Claude Code**: probes `--version`, stream-json flags, and stdio permission tool.
- **Cursor**: probes `agent --version`, stream-json output format, and `agent status`.
- **Codex**: probes `codex --version`, `exec --help` for `--json` / `--sandbox`, and `codex login status`.
- **OpenCode**: probes `opencode --version`, `run --help` for `--format json` / `--auto`, and `opencode models`.

If a new adapter needs multiple modes, prefer a capability probe plus explicit mode normalization instead of hardcoding assumptions.

## Live Requests and Sessions

If the adapter supports permission requests, clarification requests, or resumable sessions, verify it against:

- `file-backed-live-request-store.ts`
- `default-agent-session-store.ts`
- `local-agent-session-supervisor.ts`
- `remote-agent-session-supervisor.ts`

Those files define the persisted request and session behavior that the CLI and dashboard depend on.

## Source of Truth

Prefer:

- `packages/schemas/src/runner/built-in-runner-ids.ts`
- `packages/agent-protocol/src/agent-protocol-types.ts`
- `packages/agent-adapters/src/`
- `packages/runner/src/infrastructure/runner-system/cli-agent-runner.ts`
- `packages/cli/src/composition-root.ts`
