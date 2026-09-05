# @ai-dev-orchestrator/recovery

Recovery manager and state reconstruction for resuming interrupted orchestration runs. Handles graceful shutdown coordination, artifact consistency checks, and rebuilding workflow state from persisted data.

## Architecture Layer

**Domain** -- implements crash recovery, shutdown sequencing, and state reconstruction from disk.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`

## Structure

```
src/
  infrastructure/
    recovery/
      __tests__/
```

## Key Exports

### Infrastructure

- `RecoveryManager` -- coordinates the full recovery process for an interrupted run
- `StateReconstructor` -- rebuilds in-memory workflow state from journal and artifact files
- `ShutdownCoordinator` -- manages graceful shutdown sequencing and lock file cleanup
- `ArtifactConsistencyChecker` -- verifies artifact integrity after an unclean shutdown

### Schemas and Types

- `recoveryResultSchema`, `RecoveryResult` -- result of a recovery attempt
- `recoveryScenarioSchema`, `RecoveryScenario` -- describes the detected recovery scenario
- `shutdownStateSchema`, `ShutdownState` -- persisted shutdown state
- `lockFileContentSchema`, `LockFileContent` -- lock file structure
- `RepairResult` -- result of an artifact repair operation
- `StateRebuilder` -- interface for custom state rebuilding strategies
