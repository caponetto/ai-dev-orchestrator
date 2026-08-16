import { randomUUID } from 'node:crypto';

import type { SpecificationId } from '@ai-orchestrator/schemas';

export function createSpecificationId(value?: string): SpecificationId {
  return (value ?? randomUUID()) as SpecificationId;
}
