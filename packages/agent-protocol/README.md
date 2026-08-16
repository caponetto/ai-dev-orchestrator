# @ai-orchestrator/agent-protocol

Defines the typed message protocol between agents and the orchestrator. All communication flows through structured messages with versioned payloads, enabling transport-agnostic agent integration.

## Architecture Layer

**Domain** -- specifies the contract that agents and the orchestrator use to exchange handshakes, progress updates, artifacts, permissions, clarifications, and completion signals.

## Workspace Dependencies

- `@ai-orchestrator/schemas`

## Structure

```
src/
  __tests__/
```

## Key Exports

**Constants**:

- `PROTOCOL_VERSION` -- current protocol version
- `KNOWN_CAPABILITIES` -- supported agent capabilities
- `AGENT_TO_ORCHESTRATOR_TYPES`, `ORCHESTRATOR_TO_AGENT_TYPES`, `ALL_MESSAGE_TYPES` -- message type enums

**Functions**:

- `createProtocolMessage` -- factory for constructing typed protocol messages
- `resetMessageCounter` -- test utility to reset sequence numbers
- `payloadToRecord` -- payload serialization helper

**Types** -- message types for each protocol exchange:

- `HandshakeMessage`, `HandshakeAckMessage` -- session establishment
- `ProgressMessage`, `LogMessage` -- status reporting
- `ArtifactMessage`, `DoneMessage`, `ErrorMessage` -- work completion
- `PermissionRequestMessage`, `PermissionResponseMessage` -- permission flow
- `ClarificationRequestMessage`, `ClarificationResponseMessage` -- human-in-the-loop
- `AbortMessage` -- cancellation
- `AgentToOrchestratorMessage`, `OrchestratorToAgentMessage` -- union types
- `TypedProtocolMessage`, `PayloadMap` -- generic helpers
