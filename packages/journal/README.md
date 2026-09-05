# @ai-dev-orchestrator/journal

Journal writer and reader for persisting orchestration events to disk. Formats workflow events into human-readable, append-only journal files that serve as the audit trail for a run.

## Architecture Layer

**Domain** -- handles serialization, formatting, and file I/O for the event journal.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Key Exports

### Domain

- `JournalWriteError`, `JournalReadError`, `JournalCorruptionError` -- journal error hierarchy

### Infrastructure

- `DefaultJournalWriter` -- writes events to the journal file
- `DefaultJournalReader` -- reads and parses journal entries from disk
- `SequenceFactory` -- generates monotonically increasing sequence numbers for entries
- `formatEvent` -- formats a single event into its journal representation
- `formatEvents` -- formats a batch of events
- `formatJournalHeader` -- produces the header block for a new journal file
- `flushToFile` -- writes buffered journal content to disk
