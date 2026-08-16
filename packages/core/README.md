# @ai-orchestrator/core

Central infrastructure for configuration loading, event dispatch, state persistence, repository discovery, and structured logging. Provides the foundational services that all higher-level packages depend on.

## Architecture Layer

**Infrastructure** -- wires together configuration, events, state, and logging into a coherent runtime foundation.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`

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

- `DefaultStatePersistence` -- persists and loads orchestration state
- `computeStateChecksum` -- integrity checksum for state snapshots
- `rebuildStateFromEvents` -- reconstructs state from an event log
- **Errors:** `LockAcquisitionError`, `RunAlreadyActiveError`, `SchemaIncompatibleError`, `StateCorruptionError`, `StatePersistenceError`

### Logging

- `createLogger` -- creates a structured logger instance
- `noopLogger` -- silent logger for testing
