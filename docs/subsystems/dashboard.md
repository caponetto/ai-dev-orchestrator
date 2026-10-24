# Dashboard Subsystem

The dashboard is implemented across:

- `packages/dashboard/src/`
- `packages/dashboard-server/src/dashboard/`

`ai dashboard` starts the HTTP API and a Vite-hosted frontend.

## What Exists Today

The dashboard is an interactive local web UI. It is not read-only.

Current views and features include:

- run list and run detail pages
- workflow graphs derived from the actual workflow definition
- artifact lists and artifact content display
- findings and verdict summaries
- token and budget summaries
- live agent output and live request panels
- active session views for a run
- project settings editing (including permission approvals)
- workflow previews in the new-run flow
- health page

## Operator Actions

The current HTTP action surface supports:

- approve a waiting run
- reject a waiting run
- answer a waiting prompt
- abort a run
- retry an aborted or failed run
- delete a run
- create a new run
- respond to live permission requests
- respond to live clarification requests

These actions are handled through `DefaultDashboardActionHandler` in the CLI package and surfaced by `dashboard-http-server.ts`.

When an abort request supplies a session ID, the handler checks it against the current live
session before signalling the run process or aborting the session. A mismatched ID is rejected
without those side effects, so a stale dashboard view cannot terminate a newer session.

Retry starts the CLI without rewriting the checkpoint or journal in the dashboard process.
The engine acquires the run lock before selecting and persisting the retry state. A spawn
failure therefore leaves execution state intact. Retry refuses completed successful runs and
runs whose lock owner is live, foreign, or unverifiable; it does not terminate a live cleanup
process to force a retry.

## Settings

The settings page loads and writes project settings through `FilesystemSettingsProvider`.

The current UI edits:

- role assignments
- iteration limits
- quality gate thresholds
- budget settings
- permission policy
- permission approvals
- runtime log level

## HTTP Surface

The dashboard server currently exposes endpoints for:

- run summaries and run detail data
- per-run sessions
- per-run live requests
- workflow preview by name
- approve, reject, answer, abort, retry, delete, and create-run actions
- permission and clarification responses
- settings read and update

Live permission/clarification POSTs return `{ ok: true, outcome }`, where `outcome` is
`response_written` or `already_responded`. Both acknowledge a stored decision, not agent
consumption or workflow completion. Identical retries remain valid after expiry or active-file
cleanup. Unknown requests return 404, malformed bodies/identifiers and wrong response kinds return
400, conflicting decisions return 409, unanswered expired requests return 410, and storage failures
return 500. Public submissions require a cataloged request; they cannot create early responses.

The existing `permission_resolved` and `clarification_resolved` diagnostic events include the
storage outcome and are emitted only for new writes. Event publication is best-effort: a failed
notification cannot turn a committed decision into an HTTP failure. These events provide no
durable delivery or agent-consumption acknowledgement.

## Source of Truth

Prefer:

- `packages/dashboard-server/src/dashboard/dashboard-http-server.ts`
- `packages/dashboard-server/src/dashboard/filesystem-settings-provider.ts`
- `packages/dashboard-server/src/dashboard/view-projector.ts`
- `packages/dashboard/src/pages/RunDetailPage.tsx`
- `packages/dashboard/src/pages/NewRunPage.tsx`
- `packages/dashboard/src/components/WorkflowGraph.tsx`

## Production action coverage

E2E tests have a dedicated TypeScript project at `packages/dashboard/e2e/tsconfig.json`.
The dashboard's `typecheck` and `lint` commands include E2E files, so typed ESLint also works
when lint-staged checks an individual browser test before commit.

`production-actions.e2e.ts` exercises approval, abort and retry through the browser, real HTTP server, production action/data handlers and actual CLI child commands. It uses disposable run/configuration directories and deterministic agents. Dashboard E2E builds CLI development artifacts through its Turbo task dependency before starting this fixture.

## Observed control stages

Action HTTP responses retain their existing success/error fields and HTTP status codes, with
optional `outcome` (`started`, `aborted`, `already_terminal`) and `finalState` fields. Older
responses without those fields remain accepted. A successful launched action means the OS
created its child process; ownership and workflow completion are later observations.

Retry and approval/rejection/answer stream events describe requests (`retry_requested`,
`approval_requested`, `rejection_requested`, `text_requested`), after spawn acknowledgement.
They do not synthesize agent permission or clarification responses. Actual workflow and protocol
events remain the evidence of execution. Failed launches may emit `request_failed`, never a
successful request event. Stream reporting is best-effort after an outcome is known.

UI feedback follows that distinction: retry and run creation are requested, and approval/rejection
banners describe requests. Abort displays the explicit committed/terminal outcome; a legacy
success without an outcome uses acknowledgement wording. Completing during an abort keeps DONE
and produces an already-terminal response rather than an aborted toast/event. In-flight controls
remain mounted and disabled while the request is pending. Launch errors stay visible and retryable;
a requested-stage banner allows another response if the run is still waiting. A new wait resets the
form. Deduplication covers one handler's spawn window,
not durable repeated requests after acknowledgement.
