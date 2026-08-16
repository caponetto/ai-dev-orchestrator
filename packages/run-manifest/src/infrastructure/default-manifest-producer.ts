import type { ManifestProducer } from '@ai-orchestrator/ports';
import type { ManifestContext, RunManifest } from '@ai-orchestrator/schemas';

import { assembleManifest } from './manifest-assembler';

/** Default implementation of the ManifestProducer port. */
export class DefaultManifestProducer implements ManifestProducer {
  /** @inheritdoc */
  produce(context: ManifestContext): RunManifest {
    return assembleManifest(context);
  }
}
