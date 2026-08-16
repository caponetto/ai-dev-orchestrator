import type { CanonicalSpecification } from '@ai-orchestrator/schemas';

import { createSpecificationId } from '../domain/types';

export function createNextVersion(
  previous: CanonicalSpecification,
  updates: Partial<
    Omit<CanonicalSpecification, 'id' | 'version' | 'previousVersion' | 'createdAt'>
  >,
): CanonicalSpecification {
  const now = new Date().toISOString();
  return {
    ...previous,
    ...updates,
    id: createSpecificationId(),
    version: previous.version + 1,
    previousVersion: previous.id,
    createdAt: previous.createdAt,
    updatedAt: now,
  };
}
