# @ai-dev-orchestrator/ports

Port interfaces (abstract contracts) that define the boundaries between domain logic and infrastructure. Implementations live in their respective packages; consumers depend only on these interfaces.

## Architecture Layer

**Contracts** -- enforces hexagonal architecture by decoupling domain from infrastructure through typed interfaces.

## Workspace Dependencies

- `@ai-dev-orchestrator/schemas`

## Structure

```
src/
  contracts/
  shared/
```

## Key Exports

**Port interfaces** (all exported as types):

- `ConfigurationLoader`, `ConfigurationProvider`, `SettingsProvider` -- configuration
- `EventBus`, `EventJournal` -- eventing
- `ArtifactStore`, `OwnershipRegistry`, `ArtifactTypeValidator` -- artifact system
- `DependencyGraph`, `ProvenanceTracker`, `StalenessDetector`, `ImpactAnalyzer` -- dependency tracking
- `AgreementValidator`, `AgreementGate` -- agreement artifacts
- `SpecificationValidator`, `SpecificationMerger` -- specification handling
- `RoleRegistry`, `PromptEngine`, `PromptTemplateRegistry`, `TokenEstimator` -- prompt/role system
- `AgentRunner`, `AgentStreamBus`, `AgentSessionSupervisor`, `AgentSessionStore` -- agent execution
- `RunnerSystem`, `CollaborationModel` -- runner orchestration
- `PolicyEngine`, `GovernanceEngine`, `IterationContractRegistry` -- governance
- `PolicyEvaluator`, `PolicyRegistry`, `PolicyResolver` -- policy evaluation
- `StatePersistence`, `JournalWriter`, `JournalReader` -- persistence
- `ManifestProducer`, `ManifestQuery`, `ManifestWriter` -- run manifests
- `WorkflowEngine` -- workflow lifecycle
- `MetricsCollector`, `HealthChecker`, `DiagnosticsEngine` -- observability
- `DashboardDataProvider`, `DashboardActionHandler`, `DashboardEventStream` -- dashboard
- `PermissionPolicy`, `PermissionDecision` -- permission system
- `Logger`, `LogLevel` -- logging

**Shared utilities**:

- `OrchestratorError`, `RecoverableErrorBase`, `NonRecoverableErrorBase` -- error base classes
- `createRunId`, `createWorkerId` -- branded type constructors
- `noopLogger` -- silent logger for testing
