// Domain — Artifact System
export type { ArtifactDescriptor } from './domain/artifact-system/index';
export {
  ARTIFACT_DESCRIPTORS,
  ARTIFACT_SCHEMA_MAP,
  acceptanceValidationContentSchema,
  agreementContentSchema,
  canonicalSpecificationContentSchema,
  clarificationAnswersContentSchema,
  codebaseContextContentSchema,
  escalationContextContentSchema,
  implementationContentSchema,
  intakeAnalysisContentSchema,
  intakeRequirementsContentSchema,
  judgeDecisionContentSchema,
  planContentSchema,
  releaseSummaryContentSchema,
  remediationPlanContentSchema,
  reviewContentSchema,
  reviewFindingsContentSchema,
  reviewReportContentSchema,
  runManifestContentSchema,
  testPlanContentSchema,
  testSuiteContentSchema,
  validatePlanStructure,
  verificationContentSchema,
} from './domain/artifact-system/index';
export {
  ArtifactNotFoundError,
  ChecksumMismatchError,
  DiskWriteError,
  ImmutabilityViolationError,
  InventoryCorruptionError,
  OwnershipViolationError,
  TypeValidationError,
} from './domain/artifact-system/index';
export {
  AGREEMENT_ARTIFACT_TYPES,
  REVIEW_ARTIFACT_TYPES,
  VERDICT_ARTIFACT_TYPES,
} from './domain/artifact-system/index';

// Domain — Agreement Artifacts
export { AgreementGateError, InvalidAgreementError } from './domain/agreement-artifacts/index';

// Infrastructure — Artifact System
export {
  buildOwnershipOverrides,
  FilesystemArtifactStore,
  DefaultOwnershipRegistry,
  DefaultArtifactTypeValidator,
  computeChecksum,
  verifyChecksum,
  safeJsonParse,
  parseTypedArtifactContent,
  parseFrontmatter,
  parseJson,
  parseYaml,
  parseArtifactContent,
  FRONTMATTER_REGEX,
  VersionManager,
  InventoryManager,
} from './infrastructure/artifact-system/index';
export type { SafeParseResult } from './infrastructure/artifact-system/index';

// Infrastructure — Agreement Artifacts
export {
  DefaultAgreementGate,
  AgreementGenerator,
  DefaultAgreementValidator,
} from './infrastructure/agreement-artifacts/index';

// Infrastructure — Shared
export { hashContent } from './infrastructure/shared/hash';
