import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Thrown when manifest production fails. */
export class ManifestProductionError extends NonRecoverableErrorBase {
  readonly code = 'MANIFEST_PRODUCTION_ERROR';

  constructor(readonly cause: string) {
    super(`Manifest production failed: ${cause}`);
  }
}
