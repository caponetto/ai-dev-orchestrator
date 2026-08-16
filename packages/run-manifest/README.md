# @ai-orchestrator/run-manifest

Manifest production, serialization, and report rendering for completed orchestration runs. Assembles run results into a structured manifest and writes them to the filesystem.

## Architecture Layer

**Domain** -- produces and persists the output artifacts of an orchestration run.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`

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

- `ManifestProductionError`

### Infrastructure

- `DefaultManifestProducer` -- orchestrates manifest assembly
- `DefaultManifestQuery` -- queries over produced manifests
- `FilesystemManifestWriter` -- writes manifests to disk
- `assembleManifest` -- assembles a manifest from run data
- `renderReport` -- renders a human-readable report from a manifest
- `serializeManifest` -- serializes a manifest to a storable format
