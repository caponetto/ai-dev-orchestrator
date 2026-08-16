# @ai-orchestrator/test-utils

Shared test fixtures, mock port implementations, and helper utilities used across the monorepo's test suites.

## Architecture Layer

**Testing** -- provides reusable test infrastructure so individual packages can write focused tests without duplicating setup boilerplate.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`

## Structure

```
src/
  fixtures/
```

## Key Exports

- `TEST_BUILT_IN_DEFAULTS`, `TEST_POLICIES`, `TEST_ROLES`, `TEST_ROLES_WITH_RESTRICTIONS`, `TEST_WORKFLOW` -- preconfigured fixtures for common test scenarios
- `createMockArtifactStore`, `createMockContractRegistry`, `createMockGovernance`, `createMockJournalWriter`, `createMockManifestProducer`, `createMockRunnerSystem`, `createMockStatePersistence`, `createMockStreamBus` -- factory functions that return mock implementations of port interfaces
- `createTempDir` -- creates an isolated temporary directory for filesystem tests
