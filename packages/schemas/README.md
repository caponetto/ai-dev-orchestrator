# @ai-orchestrator/schemas

Shared Zod schemas and inferred TypeScript types that define every data structure in the platform. All other packages depend on these schemas for type-safe validation at runtime boundaries.

## Architecture Layer

**Foundation** -- provides the canonical type definitions that all higher layers import.

## Workspace Dependencies

None (only external dependency: `zod`).

## Structure

```
src/
  shared/
  artifacts/
  code-intelligence/
  config/
  dashboard/
  governance/
  observability/
  persistence/
  runner/
  specification/
  workflow/
```

## Key Exports

Each sub-module exports Zod schemas (camelCase, `*Schema` suffix) and inferred TypeScript types (PascalCase). Representative exports per group:

**shared** -- `runIdSchema`/`RunId`, `workerIdSchema`/`WorkerId`, branded ID types, `Result`/`ok`/`err` monad, string enums (`ThreeTierSeverity`, `SessionTransport`, `LiveRequestKind`), `safeParseResponse`.

**artifacts** -- `ARTIFACT_TYPES`, `artifactTypeSchema`/`ArtifactType`, `artifactSchema`/`Artifact`, `agreementArtifactSchema`, `dependencyEdgeSchema`, `provenanceRecordSchema`, and 20+ related schemas.

**workflow** -- `workflowDefinitionSchema`, `stateDefinitionSchema`, `transitionDefinitionSchema`, guard and action schemas (16 guard variants, 7 action variants), `engineStateSchema`, `journalEventTypeSchema`, and 15+ event data schemas.

**specification** -- `canonicalSpecificationSchema`, `intakeResultSchema`, `iterationContractSchema`, `clarificationQuestionSchema`, and validation/merge result types.

**governance** -- `governanceDecisionSchema`, `policyDefinitionSchema`, `policyResultSchema`, `findingSchema`, `escalationContextSchema`, and 30+ policy/finding types.

**runner** -- `roleIdSchema`/`RoleId`, `ROLE_IDS`, `roleContractSchema`, `dispatchRequestSchema`, `agentSessionSnapshotSchema`, `promptTemplateSchema`, `permissionApprovalEntrySchema`, and 40+ runner/session/prompt types.

**config** -- `mergedConfigurationSchema`, `eventBusConfigSchema`, `EVENT_TYPES`, `eventSchema`, and 40+ event payload schemas (`runStartedDataSchema`, `workerDispatchedDataSchema`, etc.).

**dashboard** -- `runSummaryViewSchema`, `runStateViewSchema`, `workflowStateViewSchema`, `healthResponseSchema`, `runCreationParamsSchema`.

**observability** -- `metricEntrySchema`, `healthCheckResultSchema`, `diagnosticReportSchema`, `performanceSnapshotSchema`.

**persistence** -- `persistedStateSchema`, `runManifestSchema`, `discoveryResultSchema`, `lockHandleSchema`.
