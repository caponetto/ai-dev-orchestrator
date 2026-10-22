# Workflow Engine

The workflow engine lives in `packages/workflow/src/infrastructure/workflow-engine/`. Workflow parsing and validation live in `packages/workflow/src/infrastructure/workflow-dsl/`.

## Responsibilities

The current engine:

- loads a workflow definition
- evaluates guards and transitions
- dispatches entry actions
- coordinates `WAITING_FOR_HUMAN`
- persists state
- appends journal events
- produces a manifest and report near terminal completion

Start, resume, and retry allow one execution loop per controller. Abort sets `ABORTED` before awaiting cancellation, blocks a new execution until cancellation finishes, and prevents in-flight cleanup from reporting success. Workers cancelled during context or prompt preparation cannot launch an agent afterward; cancellation also stops queued parallel workers. Resume requested during a manual pause waits for the active action to settle and checkpoint its cursor before acquiring the next run lock. Concurrent execution or restore operations are rejected. Starting a new run clears previous usage, worker metrics, feedback, action cursors, and iteration counters.

Governance escalation pauses without advancing the requested transition and releases the run lock for resume. Model escalation evaluates the stronger model's output, reruns dependent entry actions such as agreement generation, preserves feedback and iteration context, tries each available higher tier once per state visit, and waits for a human after the tier ladder is exhausted. Completed redispatch usage counts once, including when it causes a budget pause.

If no transition matches a completed state's trigger and guards, the engine records an error and checkpoints `FAILED` when that terminal state is declared, falling back to `ABORTED` if available. Workflows with neither failure terminal checkpoint the current state and throw `TransitionError`, allowing an explicit retry. All paths release the run lock.

Live-session completion uses the session role's first owned artifact type and the `<role>-output` name from its configured role contract. Missing contracts, missing output, and artifact storage failures follow the state's failure transitions. Cancellation is checked after session attachment and response delivery before any further session action. An initial session failure returns a worker failure. A dead resumed session follows the requesting state's declared failure transition and terminal cleanup. Session token usage is included in run budgets and emitted in worker journal events so journal-only recovery preserves the same usage totals.

Entry actions stop on failure or a live-session wait. Live-session waits and token budget pauses apply to action, wait, and terminal states, including exit actions. Exit cursors retain completed entry and exit work so approval resumes without redispatching workers or charging usage again. Dynamic workers retain task and session identities, handle pending task sessions in turn, and produce the task specification aggregate after those sessions finish. Their cursors preserve completed work and usage through approval or session reattachment. A wait-state session returns to the ordinary human gate after its remaining entry actions finish. Manual pauses preserve that gate’s original requesting state through restore. Required wait-state entry failures evaluate the state's declared failure transitions, including priorities, guards, and custom targets, instead of presenting approval as safe. Scripts with `storeOutput` fail when stdout is empty or artifact storage fails. A checkpoint stores completed results, the next action index, and dispatch context so resume continues remaining actions after the session output is stored. Parallel review results already received remain part of the review decision. A transient attach, response, or advance error preserves the waiting context and releases the lock for retry.

Cancellation is checked between actions and after asynchronous guard evaluation before any transition or escalation is applied. A manual pause stops the active action batch at the next boundary, checkpoints completed entry or exit actions, and releases the run lock. Approval resumes the remaining actions without repeating completed work; rejection aborts the paused run. Workflow deadlines are checked between actions and after entry, exit, guard, and terminal work, so an overdue final action cannot report success. Failed exit or terminal actions cannot leave the run successful: the engine enters `FAILED` or `ABORTED`, or throws an action error when no failure terminal can complete. Terminal cleanup is attempted at most once per terminal state per execution. While cleanup is pending, checkpoints retain the last stable source state with `pendingTerminalState`, `terminalRecoveryState`, and a terminal action cursor. Each completed cleanup action is checkpointed before the next starts. Retry, including dashboard retry, continues unfinished cleanup without rerunning workers or completed actions. A terminal completion journal event clears pending cleanup only after all required actions succeed; journal-only recovery also honors pending terminal transitions.

Approved budget extensions survive checkpoint restore and journal replay. Completed results are checkpointed before approval resumes execution. Run locks are released even when error journaling fails, and the original execution error is preserved. Rejecting a budget extension aborts the run, including workflows that do not define a human-wait state. Review feedback and the last trigger are included in the next-state checkpoint before the next worker runs.

Each checkpoint is durably journaled as `workflow_checkpoint` before the checkpoint file is written. These events preserve live-session identity, pending requests, dispatch context, budget decisions, and action cursors, so journal-only recovery resumes completed terminal work without repeating it. Session completion events include the updated entry and exit action cursor alongside token usage. Journal replay applies both together, so a crash before the next checkpoint cannot re-request the completed session’s approval or charge its completion twice. Transition counters prevent replaying a transition already included in a checkpoint event. Older session events retain their session identifier; recovery without that identifier fails instead of advancing past the worker.

Journal-only recovery preserves ordered state visits and rebuilds token totals from completed and failed workers. Transition events carry exact iteration and judge-arbitration snapshots; older journals use the shared built-in state-to-contract mapping. Human rejection resets review rounds, matching normal execution.

Resume reconciles a valid checkpoint with subsequent durable journal events, including terminal action cursors written before a checkpoint-file failure. Intentional checkpoint edits such as dashboard retry take precedence over older journal snapshots. The persisted repository path is restored before rebuilding run infrastructure, so workers continue in a repository selected by a setup script.

Human text responses become feedback for the next worker. States declared with `type: wait` expose their waiting context regardless of their name and require resume rather than retry. Human-driven transitions execute the source state's exit actions; their cursors retain the original response and waiting context across session, budget, and manual pauses. Aborting a paused run executes every declared `ABORTED` entry action and checkpoints terminal cleanup progress. Completing a dynamic task session updates only the matching session, preserving completed peer artifacts. Review and judge artifacts marked as having failed validation cannot approve a transition, including artifacts produced after session reattachment.

## Workflow Sources

The repository currently ships built-in workflows from `packages/config-templates/src/static/workflows/`.

Available names:

- `dev`
- `pr-review`
- `task-breakdown`

The CLI resolves the built-in workflow by name rather than loading a project-owned workflow from `.ai/`.

## Current Action Types

The workflow schema and runtime currently support entry actions including:

- `dispatch_worker`
- `dispatch_parallel_workers`
- `run_script` — executes a named script from `~/.ai/scripts/` (TypeScript via Node; other executables via shebang). Scripts may write `{"message":"..."}` to `$ORCHESTRATOR_SCRIPT_RESULT` for chat display. Exceeding the timeout fails the action even if a signal handler exits with code zero.
- `notify_human`
- `generate_agreement`
- `produce_manifest`
- `record_journal`
- `store_artifact`

## Default Development Workflow

The built-in `dev` workflow contains these states:

1. `INTAKE`
2. `REFINEMENT`
3. `WAITING_FOR_HUMAN`
4. `CODEBASE_ANALYSIS`
5. `PLANNING`
6. `PLAN_REVIEW`
7. `IMPLEMENTATION`
8. `TEST_AUTHORING`
9. `CODE_REVIEW`
10. `REVIEW_SYNTHESIS`
11. `JUDGE_REVIEW`
12. `REMEDIATION_TRIAGE`
13. `TEST_EXECUTION`
14. `ACCEPTANCE_VALIDATION`
15. `WRAP_UP`
16. `DONE`
17. `FAILED`
18. `ABORTED`

`CODE_REVIEW` uses `dispatch_parallel_workers` for the built-in reviewer set. `WAITING_FOR_HUMAN` is reused for multiple human-interaction paths and routed by waiting context.

## PR Review Workflow

The built-in `pr-review` workflow has a default budget of 7,000,000 tokens per run,
which takes precedence over the global governance budget. Existing runs retain their saved
workflow definition and budget.

The `pr-review` workflow is a production-hardened review pipeline:

1. `SETUP` — Clone PR repository and check out the PR branch
2. `INTAKE` — Validate inputs, resolve structured source references, produce `canonical_specification`
3. `DIFF_COMPUTATION` — Compute diff between PR branch and base
4. `REVIEW_EXECUTION` — Parallel multi-perspective review
5. `REVIEW_SYNTHESIS` — Synthesize findings into unified `review_report`
6. `WRAP_UP` — Generate final `review_findings` report
7. `PUBLISH_FINDINGS` — Upload findings to a GitHub Gist via `run_script`
8. `CLEANUP` — Clean up temporary resources
9. `DONE` / `FAILED` / `ABORTED`

### Fail-closed semantics

- `iteration_exhausted` → `ABORTED` (prevents infinite review loops)
- `human_input` → `ABORTED` (explicit escalation when human intervention needed)
- `failure` → `ABORTED` (hard process failures, incomplete review sets)
- Required template variables throw `RequiredVariableMissingError` instead of silently defaulting to empty strings
- Review synthesis is blocked when required reviewer artifacts are missing

### Source resolution

The CLI intake router (`packages/cli/src/intake-router.ts`) parses typed source references:

- `github:owner/repo#123` — GitHub PR (optional `@base-branch`)
- `github-issue:owner/repo#456` — GitHub issue
- Plain text fallback for unrecognized formats

Parsed metadata flows into `rawFields` on `IntermediateRequirements` so downstream roles receive structured context.

## Task Breakdown Workflow

The `task-breakdown` workflow reviews decomposition for at most three rounds, aborting if the third review rejects it. Dynamic specification workers retain their original task IDs in the aggregate output even when earlier workers fail. Items without an ID use their original input index for the generated task ID.

## Key Runtime Files

See `packages/workflow/src/infrastructure/workflow-engine/` for the full set. Core files include:

- `lifecycle-controller.ts` — main workflow loop and state progression
- `action-dispatcher.ts` — entry action execution (dispatch, notify, store, etc.)
- `transition-evaluator.ts` — evaluates outgoing transitions from current state
- `guard-checker.ts` — guard condition evaluation
- `review-result-interpreter.ts` — interprets review artifacts into transition decisions
- `escalation-handler.ts` — escalation path handling
- `script-executor.ts` — `run_script` action execution
- `resolve-canonical-specification.ts` — specification assembly for downstream roles
- `post-run-context-updater.ts` — post-run project context updates
- `confidence-extractor.ts` — confidence score extraction from agent output

## Source of Truth

Prefer:

- `packages/workflow/src/infrastructure/workflow-engine/`
- `packages/workflow/src/infrastructure/workflow-dsl/`
- `packages/config-templates/src/static/workflows/dev.yaml`
- `packages/config-templates/src/static/workflows/pr-review.yaml`
- `packages/config-templates/src/static/workflows/task-breakdown.yaml`
