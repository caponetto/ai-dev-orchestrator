# @ai-dev-orchestrator/artifacts

Artifact system implementing typed, immutable, content-addressed artifacts with ownership enforcement and agreement gates. Provides both domain logic (schemas, descriptors, validation) and infrastructure (filesystem storage, checksum verification, inventory management).

## Architecture Layer

**Domain** -- core artifact lifecycle including storage, ownership, type validation, versioning, and agreement workflows.

## Workspace Dependencies

- `@ai-dev-orchestrator/ports`
- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`

## Structure

```
src/
  domain/
    artifact-system/
    agreement-artifacts/
  infrastructure/
    artifact-system/
    agreement-artifacts/
    shared/
```

## Key Exports

**Domain -- Artifact System**:

- `ARTIFACT_DESCRIPTORS`, `ARTIFACT_SCHEMA_MAP` -- artifact type registry and schema mapping
- Content schemas: `planContentSchema`, `implementationContentSchema`, `reviewContentSchema`, `testSuiteContentSchema`, `agreementContentSchema`, and 15 more
- `AGREEMENT_ARTIFACT_TYPES`, `REVIEW_ARTIFACT_TYPES`, `VERDICT_ARTIFACT_TYPES` -- artifact type groupings
- `validatePlanStructure` -- structural validation for plan artifacts
- Error classes: `ArtifactNotFoundError`, `OwnershipViolationError`, `ImmutabilityViolationError`, `ChecksumMismatchError`, `TypeValidationError`, `DiskWriteError`, `InventoryCorruptionError`

**Domain -- Agreement Artifacts**:

- `AgreementGateError`, `InvalidAgreementError`

**Infrastructure -- Artifact System**:

- `FilesystemArtifactStore` -- disk-backed artifact storage
- `DefaultOwnershipRegistry` -- ownership enforcement
- `DefaultArtifactTypeValidator` -- Zod-based type validation
- `VersionManager`, `InventoryManager` -- versioning and inventory tracking
- `computeChecksum`, `verifyChecksum` -- content-addressed integrity
- `parseFrontmatter`, `parseJson`, `parseYaml`, `parseArtifactContent`, `parseTypedArtifactContent`, `safeJsonParse` -- content parsers

**Infrastructure -- Agreement Artifacts**:

- `DefaultAgreementGate`, `AgreementGenerator`, `DefaultAgreementValidator`

## Write and recovery boundaries

Stores sharing a resolved artifacts directory serialize version allocation, content, metadata and inventory writes within one process. Failed queued writes do not block later writes. Cross-process mutation requires the orchestrator run lock. Version discovery matches the complete artifact name/version suffix, so names with shared prefixes remain independent.

Inventory reads refresh from disk. Malformed/schema-invalid inventories and inconsistent reference fields raise `InventoryCorruptionError`; they are never silently replaced with an empty index. After stopping writers and inspecting content/metadata, explicitly call `InventoryManager.rebuild()` to rebuild the index from valid metadata. Content, metadata and inventory are separate durable writes, so a crash can leave orphan files or an index missing a committed pair. Inspect/repair orphan pairs with recovery's `ArtifactConsistencyChecker`, then rebuild the inventory; this is an explicit maintenance API, not automatic CLI recovery. Preserve a copy before destructive repair.
