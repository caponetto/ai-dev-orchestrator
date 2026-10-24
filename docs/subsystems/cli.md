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

`ai retry <runId>` retries failed or aborted runs directly; no manual checkpoint edit is
required. The engine selects and checkpoints the previous action state while holding the
run lock. It preserves the saved repository and prior usage. Pending terminal cleanup resumes
its saved cursor. Completed successful runs and pending human gates are not retry targets.

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

`ai resume` resumes interrupted work and eligible persisted approval waits. Text waits require
`ai answer`; live permission requests use `ai permit`.

`ai permit` selects permission waits from recovered checkpoint/journal state and preserves the
selected session and request IDs while restoring the engine. A changed wait fails rather than
delivering the answer to a replacement request. Its exit status follows the resumed workflow:
DONE or a new wait returns 0, FAILED returns 3, and ABORTED returns 4. JSON includes the workflow
outcome, final state and exit code alongside the permission `action` and `messageId`; granting
permission does not itself establish that the tool ran successfully.

File-backed `ai permit` and `ai answer --message-id` require a cataloged request. Explicit IDs
support identical retries even after cleanup: `outcome: response_written` means storage committed,
and `already_responded` means the same decision was already recorded. A conflicting answer fails.
An untargeted permit with no pending request reports `no_pending_requests`. These acknowledgements
do not establish that the agent consumed the response. Blank explicit permission IDs are invalid.

During interactive `ai run`, live permission and clarification prompts share one terminal reader.
Requests are offered in pending-list order, one at a time, and polling does not overlap slow reads.
Permission answers accept `y`/`yes`, `n`/`no` (case-insensitive), and Enter retains the displayed
`[Y/n]` default grant. Other input does not submit a decision. Clarification answers must contain
non-whitespace text; their original text is preserved.

The prompt waits for response storage before reporting `stored` or `already recorded`. Writes
require the selected cataloged request. Failures are reported locally and requests still pending
are reoffered on the next poll. Dashboard answers, expiry and cancellation remove stale questions
at the next successful poll; strict storage validation handles races between polls. A conflicting
decision cannot replace the first stored response. Storage acknowledgement does not confirm agent
consumption or tool execution.

EOF closes interactive prompting without submitting a default response; the operator can inspect
pending requests and use `ai permit` or `ai answer --message-id`. Workflow shutdown closes the
reader and ignores late input/polls. A write already started may still commit after shutdown;
its result is handled without restarting prompts or printing a late success. Shutdown does not
wait indefinitely for storage. Real terminal regression tests use the system `script` utility on
macOS/Linux; deterministic prompt lifecycle tests also run without a terminal.

Ctrl+C in a live prompt requests workflow shutdown, closes the question and submits no default
answer. EOF only closes prompting. Process SIGINT/SIGTERM and prompt interrupts use the same
shutdown coordinator. Requests are idempotent: repeated signals retain the first reason and
deadline. Cancellation starts for active workers and live sessions belonging to the current run.
Graceful interruption returns the observed ABORTED outcome with exit code 4; a completed DONE
result keeps exit code 0. Cleanup/persistence errors remain errors.

Once infrastructure has been assembled, the CLI gives shutdown 10 seconds. If an operation or
cancellation backend remains unresolved, it exits with code 4 and a timeout diagnostic, without
claiming cleanup finished or emitting a fabricated final-state result. Timeout errors respect
`--json` on stderr. It preserves durable
checkpoint/journal progress and leaves an active owner's lock for dead-process recovery. Inspect
the run and external work before explicitly retrying. A write started before interruption can
still commit. The timer requires a responsive Node event loop and cannot preempt blocked JavaScript.

Commands dispose signal handlers and the deadline on success, error and validation returns;
failed context creation/restoration also removes installed handlers. Embedded callers using
orchestrator factories directly own `shutdownCoordinator.uninstall()` after using the context.

## Source of Truth

Prefer:

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/`
- `packages/cli/src/composition-root.ts`

## External abort ownership

CLI, dashboard and kill-command checkpoint aborts wait briefly for a signalled owner to exit, then acquire the run lock and reload the latest checkpoint/journal progress before writing. If ownership remains live, foreign or unreadable, the abort checkpoint is refused; retry after resolving ownership. A run that completed while termination was pending keeps its terminal checkpoint. Aborted checkpoints clear stale human-wait and manual-pause flags. Process termination remains best-effort and the force-abort path does not run workflow terminal entry actions; use engine/session cancellation for graceful cleanup, and inspect temporary/external resources after a forced termination.

## Concurrent control of an existing run

`resumeOrchestrator` captures checkpoint and journal content revisions before assembling the
restored context. Once the engine acquires the run lock, it verifies those revisions before
executing the saved state or using its journal cursor. If another owner made progress, the
operation releases its newly acquired lock and fails with a request to reload the run. Reissue
resume/retry/approval using a fresh context; an old request must not overwrite the newer state.
Journal-only progress also invalidates an idle context.

The resumed context permits checkpoint saves and journal appends only while it owns the run.
Late error callbacks outside ownership do not append through the old journal writer. On release,
the context records its own state/journal revision while still holding the lock, allowing its own
subsequent pause/resume but detecting intervening progress by another owner. Run discovery and
session registry loading do not reap orphan sessions before ownership. Diagnostic logging can
still initialize or write `orchestrator.log`; it is not authoritative workflow progress.
Unrelated orphan snapshots remain until explicit maintenance; resume does not perform bulk reaping.

Dashboard abort validates an explicit session identity again after acquiring the run lock and
loading the latest state. Session cancellation happens inside that owned section. A competing
abort cannot cancel the supervisor session after losing ownership. CLI/dashboard process
termination requests remain asynchronous and best-effort; sending a signal and acquiring the
run lock are separate effects. The final checkpoint is decided from the state read under the
lock, so completion committed in the meantime remains authoritative.

These checks fence existing-run CLI composition, not arbitrary external file writers or remote
side effects. Custom `WorkflowEngine` integrations must provide equivalent freshness/ownership
semantics through their persistence implementation. Administrative edits and external effects
without a durable journal/checkpoint record are not an exactly-once contract.

## Control outcome reporting

Abort reports the result observed while owning the run lock. A newly committed abort returns
`status: aborted`, the observed `previousState` and `finalState: ABORTED` in CLI JSON, with exit
code 4. If DONE or ABORTED is observed with no pending terminal cleanup, the command reports
`status: already_terminal` and its `state`, with exit code 0. This applies even when completion
wins after the initial state inspection. Failed persistence/acquisition reports an error instead
of claiming an abort. Pending terminal cleanup is not treated as finished solely because its
checkpoint carries a terminal state name.

Dashboard actions return optional `outcome` and `finalState` fields alongside the existing
`success`/`error` contract. An abort outcome is either `aborted` or `already_terminal`. Only the
operation that commits an abort emits an aborted human stream event; it uses the final ABORTED
state. A repeated or completion-racing abort does not fabricate an aborted event.

Detached retry/approval/rejection/answer/create-run actions acknowledge `outcome: started` after
the child emits its OS spawn event. Sync and async spawn errors report failure; parent diagnostic
log descriptors are closed in a finally path. Cleanup and stream-notification failures cannot
undo an observed launch or committed abort. `started` does not confirm run ownership, validation
of human input, a run ID, successful execution or completion. Inspect persisted state, the journal
and child diagnostics for those later outcomes.

One dashboard handler coalesces identical requests during its pending spawn window and rejects
conflicting launch requests for that run during the same window. Entries clear after success or
failure. This is not durable/multi-server idempotency and does not define ordering among later
requests; execution remains protected by run ownership and freshness checks. Stale terminal or
session-target requests found during validation fail before spawning.

## Workflow results and process exit codes

`run`, `resume`, `retry`, `approve` (including `--reject`) and engine-backed `answer` use the
returned workflow state to decide the process exit status:

| Returned state     | Exit code | JSON outcome |
| ------------------ | --------- | ------------ |
| DONE               | 0         | `completed`  |
| FAILED             | 3         | `failed`     |
| ABORTED            | 4         | `aborted`    |
| WAITING_FOR_HUMAN  | 0         | `waiting`    |
| Other/custom state | 0         | `returned`   |

Zero can mean the command paused for further input. Check `outcome` and `finalState` before
assuming the workflow completed. Custom states retain their existing zero exit status without
being labeled completed. Requesting rejection does not force exit code 4: the observed state
decides, including failure during rejection or a workflow that continues after it. Thrown errors
retain the existing bootstrap/execution error handling.

In `--json` mode an engine result record includes `runId`, `finalState`, `outcome` and `exitCode`,
including when execution pauses. Existing action-specific `status`, artifact counts/paths and
message IDs remain available. `run`/`resume`/`retry` retain their existing progress, success, error
and summary output; JSON is a stream of newline-delimited records. Identify the workflow result
by its `finalState` and `outcome` fields, rather than assuming every line is a completion result.
Errors may also be written to stderr.

`answer --message-id` can instead write a response for a live file-backed clarification request
without running the engine. Its existing `status: live_clarification_answered` is an acknowledgement
of that write, with `outcome: response_written` and `exitCode: 0`. It has no `finalState` and does
not establish that the agent consumed the answer or the workflow completed.

### Build cache correctness

CLI development and production bundle tasks extend the root Turbo input set and add embedded
config-template assets. Command source, build configuration and assets must all invalidate cached
bundles. Script tests inspect Turbo's resolved inputs for both modes; their cache also tracks the
root and CLI Turbo configuration files.

## Persisted human answers

For a persisted non-session text wait, `ai answer` loads the latest checkpoint/journal state and
submits the observed wait state, requesting state and waiting timestamp with the answer. Blank
answers, non-text waits and attempts to replace an already accepted interrupted answer are
rejected. Session clarification and targeted live-response delivery retain their separate paths.

The CLI does not create `artifacts/clarification_answers_v1.md` before bootstrap or ownership.
The engine accepts a matching text answer under the run lock and records `lastHumanAnswer`
(content plus wait identity) in its checkpoint before exit actions. The compatibility file is
an atomic projection of that receipt, not an independently committed or inventoried artifact.
Persisted non-session answer JSON includes `accepted`; `artifactPath` is present only when the engine
confirms acceptance of that answer. Governance escalation before acceptance reports
`accepted: false` and does not present an older answer file as the new result.

A lock conflict, stale restored context, changed wait or bootstrap failure cannot replace the
file. Once acceptance is durable, a later execution/projection error can still make the command
fail; it does not revoke the accepted answer. Use `ai resume` to recover the saved input rather
than submit replacement text. Resume permits an already accepted text continuation, while a
new unanswered text wait still requires `ai answer`. Its gate check uses journal-ahead progress.

After acquiring ownership, CLI recovery repairs the file from the latest accepted checkpoint,
including a journal snapshot newer than `state.yaml`. Projection uses a flushed temporary file
and atomic rename; abandoned projection temporaries are removed under ownership. Recovery
replays the saved input rather than replacing it. Legacy checkpoints without an accepted-answer
receipt remain readable and do not trigger file reconstruction. This covers process interruption;
it does not add a multi-file hardware/power-loss transaction or turn the file into artifact history.
