# @ai-orchestrator/agent-adapters

CLI adapters that bridge vendor-specific coding agents (Claude Code, Cursor, Codex, GitHub CLI) into the orchestrator's unified agent protocol. Each adapter translates vendor stream events into protocol messages and probes for available capabilities.

## Architecture Layer

**Domain** -- implements the `AgentAdapter` interface for each supported CLI tool, normalizing their output streams and capability models.

## Workspace Dependencies

- `@ai-orchestrator/agent-protocol`
- `@ai-orchestrator/schemas`

## Structure

```
src/
  __tests__/
```

## Key Exports

**Adapter interface**:

- `AgentAdapter`, `AgentAdapterCapabilities`, `CapabilityProbeResult` -- shared adapter contract

**Claude Code**:

- `ClaudeCodeAdapter`, `createClaudeCodeAdapter` -- adapter for Claude Code CLI
- `probeClaudeCodeCapabilities`, `normalizeProbeResult` -- capability detection
- `ClaudeCodeStreamEvent`, `ClaudeAssistantEvent`, `ClaudeToolUseEvent`, `ClaudeResultEvent`, and related event types
- `narrowClaudeCodeEvent`, `parseClaudeCodeEvent` -- stream event parsing

**Cursor**:

- `CursorCliAdapter`, `createCursorCliAdapter` -- adapter for Cursor CLI
- `probeCursorCliCapabilities`, `normalizeCursorProbeResult` -- capability detection
- `CursorStreamEvent`, `CursorAssistantEvent`, `CursorToolCallEvent`, and related event types
- `parseCursorEvent` -- stream event parsing

**Codex**:

- `CodexCliAdapter`, `createCodexCliAdapter` -- adapter for `codex exec --json`
- `probeCodexCliCapabilities`, `normalizeCodexProbeResult` -- capability and authentication detection
- `CodexStreamEvent`, `CodexItemEvent`, `CodexTurnCompletedEvent`, and related event types
- `parseCodexEvent` -- JSONL event parsing

**GitHub CLI**:

- `probeGhCliCapabilities`, `normalizeGhCliProbeResult` -- capability detection
