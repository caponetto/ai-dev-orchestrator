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
