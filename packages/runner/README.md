# @ai-dev-orchestrator/runner

Agent dispatch, session management, and protocol transport for the runner system. Handles launching CLI and HTTP agent workers, processing their output, managing permissions, and coordinating parallel execution.

## Architecture Layer

**Domain** -- executes agent workers and manages their lifecycle and communication.

## Workspace Dependencies

- `@ai-dev-orchestrator/agent-adapters`
- `@ai-dev-orchestrator/agent-protocol`
- `@ai-dev-orchestrator/artifacts`
- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/prompt-engine`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    runner-system/
      __tests__/
  infrastructure/
    runner-system/
      __tests__/
```

## Key Exports

### Domain

- **Errors:** `AllRetriesExhaustedError`, `ContextAssemblyError`, `InvalidOutputError`, `OutputOwnershipError`, `WorkerDispatchError`, `WorkerTimeoutError`
- **Functions:** `parseSubmitResponse`, `shouldUseProtocolMode`, `isResumableSession`
- **Types:** `AgentSessionDescriptor`, `SessionParseResult`

### Infrastructure -- Runner System

- `DefaultRunnerSystem` -- top-level runner orchestration
- `CliAgentRunner`, `HttpAgentRunner` -- agent execution backends
- `ParallelManager` -- coordinates concurrent agent workers
- `OutputProcessor` -- validates and processes agent output
- `RunnerContextAssembler`, `AgentTaskAssembler` -- context and task assembly
- `MetricsRecorder` -- records execution metrics

### Infrastructure -- Sessions and Transport

- `AgentSessionRegistry`, `DefaultAgentSessionStore`, `AgentSessionReaper` -- session lifecycle
- `LocalAgentSessionHost`, `AgentSessionRequestRouter` -- session hosting and routing
- `LocalAgentSessionSupervisor`, `RemoteAgentSessionSupervisor`, `CompositeAgentSessionSupervisor`
- `WebSocketProtocolTransport`, `StdioProtocolTransport` -- protocol transports
- `DefaultPermissionPolicy`, `FileBackedPermissionApprovalStore` -- permission management
- `FileBackedAgentStreamBus`, `InMemoryAgentStreamBus` -- agent event streaming
