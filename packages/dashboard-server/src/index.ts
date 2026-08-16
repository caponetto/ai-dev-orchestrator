// Domain
export {
  DashboardDataError,
  HealthCheckFailedError,
  MetricsCollectionError,
  ConfigInspectionError,
  DiagnosticsError,
  FailureAnalysisError,
} from './domain/index';

// Dashboard
export {
  DashboardHttpServer,
  DefaultDashboardDataProvider,
  FilesystemSettingsProvider,
  SseEventStream,
  aggregateEvents,
  countByType,
  latestByType,
  toDashboardEvent,
  projectArtifactDetail,
  projectArtifactView,
  projectFindingsView,
  projectIterationView,
  projectRunState,
  projectRunSummary,
  projectUsageView,
  projectWorkflowPreview,
  projectWorkflowView,
} from './dashboard/index';
export type {
  DashboardDataSources,
  DashboardHttpServerOptions,
  DefinitionTransition,
  FindingData,
  ProjectWorkflowViewOptions,
  RawEvent,
} from './dashboard/index';

// Metrics
export {
  DefaultHealthChecker,
  DefaultMetricsCollector,
  PerformanceInstrumenter,
  aggregateEntries,
  groupByLabel,
  percentile,
} from './metrics/index';

// Diagnostics
export {
  DefaultDiagnosticsEngine,
  analyzeRunFailure,
  inspectConfig,
  createRequiredRule,
  createTypeRule,
} from './diagnostics/index';
export type {
  ConfigurationRule,
  DiagnosticsDataSources,
  RunFailureContext,
} from './diagnostics/index';
