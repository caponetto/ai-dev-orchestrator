import { randomBytes } from 'node:crypto';

import type { RunId, WorkerId } from '@ai-dev-orchestrator/schemas';

/** Create a RunId from a validated string, or auto-generate one. */
export function createRunId(value?: string): RunId {
  if (value !== undefined) {
    return value as unknown as RunId;
  }
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${date}-${time}-${randomBytes(16).toString('base64url')}` as unknown as RunId;
}

/** Create a WorkerId from a validated string. */
export function createWorkerId(value: string): WorkerId {
  return value as unknown as WorkerId;
}
