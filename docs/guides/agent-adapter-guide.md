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
  - Implement `translateOutput(line: string): ProtocolMessage | null` mapping vendor events into `progress`, `done`, or `error` messages. Derive completion and failure from event semantics rather than exit codes — some CLIs (e.g. Pi) exit zero even when a response fails or is aborted.
  - Map complete messages, not per-token deltas: many CLIs emit a delta event per token, and mapping each one to a protocol message fragments the run stream with hundreds of tiny or blank entries. Prefer the CLI's end-of-message event for full text, and skip echoed user/system messages (only assistant output is agent progress).
  - Prefer tool-execution lifecycle events over tool-call declaration events when the CLI offers both — the execution events carry richer detail (resolved arguments, results, error flags).
- **Capability Probe** (`src/<name>-cli-capability-probe.ts`):
  - Implement `probe<Name>CliCapabilities(options)`: checks `--version`, verifies `--help` flags (e.g. JSON format, model options), and tests auth or model availability.
  - Implement `normalize<Name>ProbeResult(result)`: returns standardized mode (`'streaming' | 'text-only' | 'unauthenticated' | 'unavailable'`) and user-facing summary.
- **Barrel Exports** (`src/index.ts`):
  - Export adapter, capability probe, normalization function, and event types.
- **Model Preflight** (`src/model-availability-probe.ts`):
  - Add a `case` for the runner ID in `probeConfig` with side-effect-free CLI flags (e.g. ephemeral session, no tools) so the `ai run` model availability preflight can actually verify the configured model. Without it, preflight only warns that checks are unsupported for the runner.

### 3. Wire Subprocess & Token Usage in Runner (`packages/runner`)

- In `packages/runner/src/infrastructure/runner-system/cli-invocation.ts`:
  - Add the runner ID to `PROMPT_BASED_ADAPTERS` if the CLI accepts the prompt as an argument.
  - Configure `stdin` handling in `resolveCliSubprocessStdinOption` (e.g. `'ignore'` to prevent CLI from waiting on stdin).
- In `packages/runner/src/infrastructure/runner-system/cli-token-usage.ts`:
  - Add vendor usage shape detection (`is<Name>UsageShape`) and parse logic to `parseVendorUsage`.
  - Wire the event parser in `extractUsageFromRawLine(line)` to extract input/output tokens per step or on final completion. Extract usage only from authoritative events (end-of-message or turn-completion events), not from per-delta update events — a delta event carrying cumulative usage will emit one `usage_update` stream event per token.
- In `packages/runner/src/infrastructure/runner-system/cli-retry-policy.ts`:
  - Add the runner ID to `SUPPORTED_ADAPTERS` so the shared transient retry policy covers the new runner. Without it, a flaky first response (for example an agent that greets and exits without using a tool or writing its artifact) fails the dispatch instead of being retried.

### 4. Wire Runner in CLI (`packages/cli`)

- **Runtime Registration** (`packages/cli/src/composition-root.ts`):
  - Probe capabilities in `createRunnerRegistry()`.
  - If available, instantiate `CliAgentRunner` with the adapter and register via `registry.set(BUILT_IN_CODING_RUNNER_ID.<NAME>, runner)`.
- **Health Page Probes** (`packages/cli/src/commands/dashboard.ts`):
  - Probe capabilities in `dashboardCommand()` and append a `RunnerHealthEntry` with `status: 'healthy' | 'degraded' | 'unhealthy'`.

### 5. Add Static Runner Config & Models (`packages/config-templates`)

- Add the runner ID, display name, and supported default models to `packages/config-templates/src/static/runners.yaml`.
- Add a model-listing script `scripts/runner-models/<runner>.ts` that calls `checkRunner` with the CLI's model listing command, add an `IGNORED_MODELS` entry in `scripts/runner-models/ignored-models.ts`, and add a job to `.github/workflows/runner-models.yml` that installs the CLI and runs the script. Without these, the scheduled model-roster drift check never covers the new runner.

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
- **Pi**: probes `pi --version`, `--help` for `--mode json` / `--model`, and `pi --list-models`.

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
- `packages/runner/src/infrastructure/runner-system/cli-invocation.ts`
- `packages/runner/src/infrastructure/runner-system/cli-token-usage.ts`
- `packages/cli/src/composition-root.ts`

## Common Pitfalls

Lessons from integrating real runners — check these before debugging deeper:

- **`spawn <cli> ENOENT` is ambiguous.** It means the command is not on the spawning process's `PATH` — _or_ the spawn `cwd` does not exist. Both produce the identical error. The model preflight already falls back to a temporary directory when a caller-supplied cwd has disappeared (e.g. a rerun whose original checkout was cleaned up), so a remaining ENOENT usually means PATH. Remember that dashboard-spawned runs inherit the **dashboard server's** environment, not the user's shell: the CLI must be on the PATH of whatever process started the server.
- **`--thinking`-style reasoning flags can blow the preflight timeout.** Models that reason by default can spend longer thinking than the probe's timeout allows for a trivial "reply OK" check. Pass the CLI's thinking-disable flag in the `probeConfig` entry for the preflight only — real dispatches keep the model's default behavior.
- **Weak models can greet and exit.** A model may answer a task prompt with a conversational introduction and stop without using any tool or writing its artifact. The shared transient retry policy absorbs this (an agent that exits without using a tool and without its artifact is safe to retry), but a model that does it consistently on a role's prompt should be reassigned to a stronger model rather than retried forever.
- **Transient provider errors are retried automatically.** The model preflight retries timeouts and recoverable errors (as classified by `isTransientCliError`) once; error messages surfaced by the adapter should carry the vendor's underlying error text (e.g. an `errorMessage` field) so the classifier and the user can tell transient blips from configuration problems.
- **Verify against the real CLI before trusting mock tests.** Unit tests with recorded event fixtures cannot catch vendor-side quirks: tail latency, default thinking modes, model-ID formats with unexpected separators (e.g. slashes), or exit-code conventions. Run the capability probe and a live model preflight against an installed CLI as a final check.
