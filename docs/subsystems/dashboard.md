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
