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

The CLI composition root probes supported local environments and currently wires built-in runner entries for `claude-code`, `cursor`, `codex`, and `opencode` when available. The Codex runner invokes `codex exec --json --sandbox workspace-write` with `-c sandbox_workspace_write.network_access=true`, forwarding the configured role model through the CLI's `--model` option. Network access is required for PR-review workflows that call `gh pr view`, `gh pr diff`, and similar GitHub API commands; without it, Codex's workspace-write sandbox blocks outbound connections to `api.github.com` even when `gh` is authenticated on the host. It records the completed turn's input and output token usage. Codex does not speak the orchestrator handshake protocol, so the CLI runner uses `stdin: ignore` (prompt is passed via argv; avoids Codex logging "Reading additional input from stdin..." to stderr) and dispatches directly instead of negotiating a resumable session first. Codex also receives `--add-dir ~/.ai` so artifact writes under the orchestrator run directory are permitted alongside the checked-out repository workspace.

The OpenCode runner invokes `opencode run --format json --auto`, forwarding the configured role model through `--model`. It records token usage per message/step from `step_finish` events. Like Codex, OpenCode does not speak the orchestrator handshake protocol, so the prompt is passed via argv with `stdin: ignore`.

At startup, the OpenCode capability probe records the models reported by `opencode models`. Before dispatch, the runner rejects a configured model missing from that list and emits an actionable error in the run stream. The dashboard shows the failure reason in the run's Chat tab. If model discovery returns no usable list, dispatch proceeds and OpenCode reports its own errors.

Claude Code, Codex, Cursor, and OpenCode use a shared retry policy for transient service errors. The CLI runner retries once after a short delay only when the agent has not used a tool or reported token usage. Both attempts share the task's original timeout, and the retry appears in the run stream. Cursor can report a service failure by exiting without a final result event; the runner also checks stderr from a nonzero exit in that case. Errors after tool work begins are returned without an automatic retry to avoid repeating side effects. Cancellation invalidates pending task-file preparation, handshake fallback and transient retry attempts as well as stopping active subprocesses; a cancelled dispatch cannot launch another attempt after a delay. New dispatches requested later can use the runner again.

Codex approval prompts are bridged to the orchestrator dashboard through a Codex `PermissionRequest` hook. Before each Codex dispatch, the runner writes a per-run hook launcher under `.ai/runs/<run-id>/` and passes a `-c hooks.PermissionRequest=...` override plus `--dangerously-bypass-hook-trust`. The hook invokes `ai codex-permission-hook`, which maps Codex approval requests into the same `DefaultPermissionPolicy` and `FileBackedLiveRequestStore` flow used by Claude Code and Cursor. File writes inside the current run's `~/.ai/runs/<run-id>/` (or repository-local equivalent) are auto-granted after resolving existing symlinks. Cross-run/global configuration writes and paths containing `..` do not receive this exemption. Other operations follow explicit rules, saved approvals and role trust.

## Protocol and Sessions

Protocol-capable runners can use the structured agent protocol types in `packages/agent-protocol/src/agent-protocol-types.ts`. Runner adapters (Claude Code, Cursor, Codex, OpenCode, gh-cli) live in `packages/agent-adapters/src/`.

The session model currently includes:

- `DefaultAgentSessionStore` for persisted snapshots under `.ai/runs/<run-id>/sessions/`
- `LocalAgentSessionSupervisor` for stdio-backed local sessions
- `RemoteAgentSessionSupervisor` for reconnectable remote sessions
- `CompositeAgentSessionSupervisor` for unified session handling

Live requests are stored under `.ai/runs/<run-id>/live-requests/` and responses under `.ai/runs/<run-id>/live-responses/`. Identifiers must be single path components. Readers require the embedded run/request IDs to match the requested file; malformed or mismatched responses leave the request pending. A response is published atomically without overwriting an existing answer. Identical retries are idempotent; conflicting answers are rejected.

Permission heuristics check actual operation types before display labels. Every pipeline segment must qualify as read-only; redirects, substitutions and compound safe-command extensions require the applicable policy/approval. Cached file approvals use path boundaries, and cached shell approvals cannot expand into another command through shell operators. Explicit deny rules retain precedence over grants. These heuristics complement the agent sandbox; they are not a general shell parser.

## Human request identity and delivery

Global worker cancellation attempts every worker and every runner backend, even if one cancellation
or signal fails. Local CLI subprocesses own private POSIX process groups and receive SIGTERM with
a five-second SIGKILL grace period. Dispatch and terminal session results wait for native child
close and completion of the group termination policy. This also cleans background descendants
when the parent exits normally or protocol completion arrives before process exit. A failed session
setup or handshake fallback waits for this cleanup before returning or launching a replacement.
Repeated cancellation does not reset the grace period; tracking remains until cleanup settles. The workflow also aborts live sessions for its run; remote cancellation is best-effort.
The CLI's shutdown deadline is a separate bound on the orchestrator process and does not establish
that remote side effects or arbitrary descendant processes have stopped.

Local and remote sessions consume a response only for a matching pending request and payload
kind. Duplicate consumed responses return false. Terminal sessions clear pending requests and
ignore later protocol requests; a local timeout also settles any pending advancement waiter.
Remote sessions ignore callbacks from replaced transports and cannot reconnect terminal hosts
or terminal persisted snapshots.

Protocol transport `send` returns whether the message was accepted locally for writing. Closed
transports and synchronous write failures return false; stdio backpressure still counts as a
queued write. Session hosts retain pending requests after failed writes so the same request can
be retried. This result is not an acknowledgement that the agent received or applied the answer.

Session snapshots commit in order per session, including after an older write fails; other
sessions can persist independently. Remote `waitForAdvance` persists an already-pending request
before returning it to the workflow.

File-backed request IDs identify one run, kind and payload. Identical request replay preserves
the original creation/expiry times; reuse for a different operation fails. Responses retain the
first published decision, allow identical retries, and reject conflicting, expired or wrong-kind
answers for published requests. Expiry compares instants, including timezone offsets, and the
expiry instant itself is expired. Malformed expiry values are rejected. Internal terminal timeout
records remain writable after expiry; strict public submissions cannot use that bypass. A failure
to persist a timeout record cannot suppress the agent's default denial or clarification abort.

CLI/HTTP submissions use `writeResponse(..., { requireRequest: true })`; internal streaming callers
retain the default ability to answer before catalog registration. The file store returns
`response_written` or `already_responded`. The interface still accepts older adapters returning
void; HTTP treats their successful return as a new write.

`cleanupResolved` first retains the immutable decision under `live-resolved/<message-id>.json`,
then removes the active request/response pair. A fresh store can acknowledge the same decision or
reject a conflicting late writer after cleanup. Retired IDs cannot be registered again. Receipts
remain until the run directory is removed; cleanup does not garbage-collect decision evidence.
Interrupted cleanup is retryable, and malformed or unreadable receipts fail closed. Cleanup is
caller-triggered and should run after consumers no longer need to poll the active response; the
receipt records storage history, not agent consumption.

Transport send and snapshot persistence are separate effects. If sending succeeds but persisting
the consumed request fails, the live host rejects a duplicate, but restart can recover the older
pending request. The protocol has no durable receiver acknowledgement/deduplication contract, so
that boundary is ambiguous and does not guarantee exactly-once delivery. Reconcile the agent's
state before retrying an ambiguous response. Local stdio sessions cannot reattach across process
restart; remote recovery retains the original run/session/request identity.

Resume construction loads session snapshots without starting orphan reaping. A contender must
not mark or delete another owner's sessions while waiting for run ownership. The owning engine
handles session reconciliation and finalization; standalone reaper maintenance requires exclusive
run ownership.

## Durable remote completion

Remote `done` freezes a completion receipt containing output, duration and optional final token
usage. Session snapshots persist that receipt before `waitForAdvance` or the host result promise
exposes success. Both immediate and already-waiting observers follow this ordering. A failed save
is observable and the in-memory receipt remains retryable; failed finalization does not discard
the host. Cancellation while the receipt is being saved cannot be reported as success.

After restart or finalization, a completed remote snapshot with a receipt can be attached and
observed locally without reconnecting or resending a human response, even after its lease expires.
Failed/aborted snapshots and legacy completed snapshots without receipts cannot fabricate output
or reopen a terminal connection. Completion duration is fixed when `done` arrives, rather than
growing on each observation. `done.tokenUsage` optionally supplies final cumulative input/output
counts; remote, local-session and ordinary CLI protocol consumers retain those counts.

The snapshot field and protocol usage field are additive; older snapshots and messages remain
valid. This provides process-restart recovery after receipt persistence. A process death before
that write completes can still require recovery from the remote agent. Snapshot write/rename is
not a power-loss/fsync guarantee, and no receiver acknowledgement or exactly-once remote delivery
contract is introduced.

## Remote reconnect ownership and leases

Concurrent attach/reconnect calls share one transport attempt per host, including while its snapshot
is being saved. Restored hosts are published before transport creation so cancellation can find them.
Abort, pause, finalization and host replacement invalidate outstanding attempts. They release waiting
callers immediately; a late transport is closed and a late failure cannot revive the old host.
Finalization remains fenced after a failed save and can be retried. A failed initial session save
closes its socket/deadline and retains a failed host for explicit persistence retry, preserving any
abort or replacement that happened during the write. Factory/write failures close
uncommitted transports and allow a later reconnect attempt without losing pending request identity.
A restored session retains its original creation time and reports `awaiting_human` when requests remain.

Local and remote delegates share a registry but expose only snapshots for their own transport type.
Composite advancement and finalization therefore select the session's owning delegate. Normal remote
WebSocket close is observed as disconnection, clears the current transport, and records reconnecting
state. The next explicit attach/reconnect can create a replacement; deliberate local close does not
report an extra connection failure.

Lease deadlines work independently of the optional heartbeat interval and are checked at reconnect
entry, after transport creation, after snapshot persistence and before sending human answers. Expiry
at the deadline (or an invalid expiry string) fails closed, clears pending requests, closes the socket,
and settles observers. The owned deadline keeps Node alive until termination/finalization; distant
leases are scheduled in bounded timer intervals. Completion receipts already observed remain terminal
and recoverable after lease expiry. Timers require a responsive Node event loop.

Expiry/disconnection callbacks observe background snapshot-write rejections. Failure observations
through `waitForAdvance` retry persistence, so a storage failure does not require reviving the session.
As with completion, the in-memory state remains available for an explicit retry if saving fails.
Each reconnect factory receives an attempt-specific `AbortSignal`. Abort, pause, finalization,
host replacement, and lease expiry cancel that signal. The production CLI factory closes a pending
WebSocket when cancelled and bounds connection establishment to 10 seconds. A failed upgrade,
close before open, timeout, or cancellation removes establishment listeners and timers and closes
the socket. Successful establishment transfers socket ownership to the session supervisor.
Custom factories may ignore the signal: callers are still released and fencing disposes late
results. Cancelling a local socket does not prove that remote work stopped. Exclusive run ownership
is still required across processes; this adds no remote fencing token or exactly-once delivery contract.

WebSocket protocol negotiation removes its message handler and deadline on success, timeout,
local/remote close, or socket error. Negotiation returns `null` when acknowledgement cannot be
sent and after the transport is closed. Message dispatch preserves other observers when negotiation
removes its own handler. The HTTP runner clears its overall task deadline on every completion path,
including handshake failure. Connection and handshake deadlines require a responsive event loop;
they do not provide remote execution cancellation or delivery acknowledgements.

## CLI execution module boundaries

`CliAgentRunner` remains the public dispatch/session facade and configuration entry point.
Its implementation delegates to focused modules under `runner-system/`:

| Module                                       | Responsibility and ownership                                          |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `cli-task-prompt.ts`, `cli-invocation.ts`    | Pure prompt/argument construction and stdin setup                     |
| `cli-token-usage.ts`, `cli-output-reader.ts` | Vendor usage parsing, output retries and fallback precedence          |
| `cli-human-request-handler.ts`               | Permission/clarification routing and policy/store configuration       |
| `cli-session-execution.ts`                   | Supervised session negotiation, registration and dispatch fallback    |
| `cli-process-registry.ts`                    | The single active-process set and cancellation generation             |
| `cli-process-execution.ts`                   | One dispatch attempt's protocol/legacy execution and completion state |
| `cli-legacy-execution.ts`                    | Legacy stream draining, token accumulation and early failure handling |
| `cli-protocol-events.ts`                     | Stateless progress/log/artifact event mapping                         |
| `cli-runner-config.ts`                       | Immutable configuration types and shared timeout defaults             |

Cancellation generations are shared by session creation and transient dispatch retries. The
per-attempt executor retains listener registration before negotiation, final-vs-delta token
precedence, close-after-stdout handling and single completion. The session host imports usage
parsing directly from its canonical module. Internal helpers are not added to the package API,
and implementation files do not end with compatibility re-exports.

## Key Implementation Files

See `packages/runner/src/infrastructure/runner-system/` for the full set. Core files include:

- `default-runner-system.ts` — orchestrates dispatch, streaming, and result handling
- `agent-task-assembler.ts` — builds agent tasks from workflow state and role contracts
- `runner-context-assembler.ts` — assembles runtime context for dispatch
- `cli-agent-runner.ts` — CLI dispatch/session facade
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

On Windows only the direct child is controlled. A descendant that creates a different group/session
escapes the owned group. Permission failures may prevent signalling. Grandchild zombies are reaped
by the OS; SIGKILL submission plus native child close completes the local termination policy,
without proving that arbitrary external effects stopped.
