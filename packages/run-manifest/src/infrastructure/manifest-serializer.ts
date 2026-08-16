import type { RunManifest } from '@ai-orchestrator/schemas';
import { stringify } from 'yaml';

/** Serializes a RunManifest to a YAML string. */
export function serializeManifest(manifest: RunManifest): string {
  return stringify(manifest, { indent: 2 });
}
