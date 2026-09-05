# @ai-dev-orchestrator/dashboard-server

HTTP server that backs the dashboard SPA. Exposes REST endpoints for run state, artifact details, workflow views, metrics, and diagnostics. Streams real-time events to the frontend via SSE.

## Architecture Layer

**Application** -- sits between the domain services and the dashboard UI, projecting internal state into HTTP responses.

## Workspace Dependencies

- `@ai-dev-orchestrator/artifacts`
- `@ai-dev-orchestrator/core`
- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/runner`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  dashboard/
  diagnostics/
  domain/
  metrics/
```

## Key Exports

- `DashboardHttpServer`, `SseEventStream` -- Hono-based HTTP server and server-sent event stream
- `DefaultDashboardDataProvider`, `FilesystemSettingsProvider` -- data source implementations
- `projectRunState`, `projectRunSummary`, `projectArtifactView`, `projectArtifactDetail`, `projectIterationView`, `projectFindingsView`, `projectUsageView`, `projectWorkflowView`, `projectWorkflowPreview` -- view projections
- `DefaultMetricsCollector`, `DefaultHealthChecker`, `PerformanceInstrumenter` -- metrics and health
- `DefaultDiagnosticsEngine`, `analyzeRunFailure`, `inspectConfig` -- diagnostics and failure analysis
