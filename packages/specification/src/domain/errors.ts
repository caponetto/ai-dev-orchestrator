import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';
import type { MergeConflict } from '@ai-dev-orchestrator/schemas';

/** Thrown when a specification fails structural validation. */
export class SpecificationSchemaError extends NonRecoverableErrorBase {
  readonly code = 'SPEC_SCHEMA_ERROR';

  constructor(
    readonly field: string,
    readonly violations: readonly { readonly path: string; readonly message: string }[],
  ) {
    const details = violations.map((v) => `${v.path}: ${v.message}`).join('; ');
    super(`Specification schema violation in "${field}": ${details}`);
  }
}

/** Thrown when a specification has semantic inconsistencies. */
export class SpecificationSemanticError extends NonRecoverableErrorBase {
  readonly code = 'SPEC_SEMANTIC_ERROR';

  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(`Semantic error in "${field}": ${detail}`);
  }
}

/** Thrown when specification merge produces unresolvable conflicts. */
export class SpecificationMergeConflictError extends NonRecoverableErrorBase {
  readonly code = 'SPEC_MERGE_CONFLICT';

  constructor(readonly conflicts: readonly MergeConflict[]) {
    super(
      `Merge produced ${String(conflicts.length)} unresolvable conflict(s): ${conflicts.map((c) => c.field).join(', ')}`,
    );
  }
}

/** Thrown when a specification version chain is broken. */
export class SpecificationVersionChainError extends NonRecoverableErrorBase {
  readonly code = 'SPEC_VERSION_CHAIN_ERROR';

  constructor(
    readonly specId: string,
    readonly missingVersion: string,
  ) {
    super(
      `Version chain broken for specification "${specId}": previous version "${missingVersion}" not found`,
    );
  }
}
