# @ai-orchestrator/dashboard

React single-page application that visualizes orchestrator runs, artifacts, workflow graphs, and metrics. Built with Vite, Tailwind CSS, Radix UI, and React Flow. Served by `@ai-orchestrator/dashboard-server`.

## Architecture Layer

**Application** -- the user-facing web UI that consumes the dashboard-server HTTP and SSE APIs.

## Workspace Dependencies

- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`

## Structure

```
src/
  api/
  components/
    artifact-renderers/
    output/
    settings/
    ui/
  hooks/
  lib/
  pages/
  test/
```

## Entry Point

This is a Vite React SPA -- there are no barrel exports. The application mounts at `src/main.tsx` and uses `react-router-dom` for client-side routing. Pages under `src/pages/` render run status, artifact details, workflow visualizations, and settings. The `src/api/` layer handles data fetching from the dashboard-server endpoints.
