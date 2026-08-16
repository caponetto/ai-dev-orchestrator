import type { ArtifactStore } from '@ai-orchestrator/ports';
import type { Artifact } from '@ai-orchestrator/schemas';

/**
 * Resolve the canonical_specification artifact using a two-step lookup:
 * first by exact type+name match, then by type-only list scan.
 *
 * The runner stores artifacts with the naming convention `<role>-output`
 * (e.g. `context_analyst-output`), so a getLatest call using the artifact
 * type as the name will miss. The list fallback handles this.
 */
export async function resolveCanonicalSpecification(
  store: ArtifactStore,
): Promise<Artifact | null> {
  const direct = await store.getLatest('canonical_specification', 'canonical_specification');
  if (direct) {
    return direct;
  }
  const refs = await store.list({ type: 'canonical_specification' });
  if (refs.length === 0) {
    return null;
  }
  try {
    return await store.get(refs[refs.length - 1]);
  } catch {
    return null;
  }
}
