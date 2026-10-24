# @ai-dev-orchestrator/core

Central infrastructure for configuration loading, event dispatch, state persistence, repository discovery, and structured logging. Provides the foundational services that all higher-level packages depend on.

## Architecture Layer

**Infrastructure** -- wires together configuration, events, state, and logging into a coherent runtime foundation.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    configuration/
    event-system/
    repository-model/
    state-persistence/
  infrastructure/
    configuration/
    event-system/
    logging/
    repository-model/
    state-persistence/
```

## Key Exports

### Configuration

- `FileSystemConfigurationLoader` -- loads and validates YAML configuration files
- `REQUIRED_CONFIG_FILES` -- list of mandatory config files
- `parseYamlFile` -- parses a YAML file with error handling
- **Errors:** `YamlParseError`, `ConfigValidationError`, `EnvVarResolutionError`, `ConfigurationLoadError`

### Repository Model

- `FilesystemRepositoryDiscovery` -- discovers git repos and the global `~/.ai/` config
- `FilesystemRuntimeDirectoryManager` -- manages `~/.ai/runs/` directory layout

- **Errors:** `RepositoryNotFoundError`, `RuntimeDirectoryError`, `RunDirectoryNotWritableError`

### Event System

- `InMemoryEventBus` -- publish/subscribe event bus
- **Errors:** `EventBusError`, `SubscriberError`

### State Persistence

Checkpoint saves atomically update the backup before replacing the primary file. The last
committed primary remains readable while a replacement is pending and if that write fails.
Run locks are reclaimed only when the local owner probe returns `ESRCH`; permission errors
and other uncertain probe failures preserve the lock.
Each new acquisition includes a unique ownership token. Release checks the saved owner and
token before removing a lock, so a delayed release cannot remove a later acquisition, even
when both share a PID and timestamp. Legacy handles without tokens remain readable.

- `DefaultStatePersistence` -- persists and loads orchestration state
- `computeStateChecksum` -- integrity checksum for state snapshots
- `rebuildStateFromEvents` -- reconstructs state from an event log
- **Errors:** `LockAcquisitionError`, `RunAlreadyActiveError`, `SchemaIncompatibleError`, `StateCorruptionError`, `StatePersistenceError`

### Logging

- `createLogger` -- creates a structured logger instance
- `noopLogger` -- silent logger for testing

## Interrupted stale-lock reclamation

A dead local owner's lock can be reclaimed once using an exclusive `run.lock.reclaim-<fingerprint>` directory. The claimant rechecks the observed owner before unlinking. Claims are retained to prevent delayed competing reclaimers from deleting a successor. If a claimant crashes before removing the old lock, acquisition fails closed. Inspect the lock and confirm every possible owner/reclaimer has stopped before an operator removes the stale lock and its matching claim. Never remove these files while a run or reclaimer may still be active. Foreign-host, unreadable and uncertain-liveness locks require operator inspection.
