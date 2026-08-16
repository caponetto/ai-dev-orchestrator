# @ai-orchestrator/artifacts

Artifact system implementing typed, immutable, content-addressed artifacts with ownership enforcement and agreement gates. Provides both domain logic (schemas, descriptors, validation) and infrastructure (filesystem storage, checksum verification, inventory management).

## Architecture Layer

**Domain** -- core artifact lifecycle including storage, ownership, type validation, versioning, and agreement workflows.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`

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
