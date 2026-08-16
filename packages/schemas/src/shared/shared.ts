import { z } from 'zod/v4';

export const AI_CONFIG_DIR_NAME = '.ai';
export const RUNS_DIR_NAME = 'runs';
export const ARTIFACTS_DIR_NAME = 'artifacts';
export const VIDEOS_DIR_NAME = 'videos';
export const TMP_DIR_NAME = 'tmp';

export const RUN_LOCK_FILENAME = 'run.lock';
export const STATE_FILENAME = 'state.yaml';
export const INVENTORY_FILENAME = 'inventory.yaml';
export const WORKFLOW_DEFINITION_FILENAME = 'workflow-definition.json';

export const MEDIA_FILE_EXTENSIONS = ['.webm', '.mp4', '.png', '.jpg', '.jpeg', '.gif'] as const;
export type MediaFileExtension = (typeof MEDIA_FILE_EXTENSIONS)[number];

export const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

export const runIdSchema = z.string().brand('RunId');
export type RunId = z.infer<typeof runIdSchema>;

export const workerIdSchema = z.string().brand('WorkerId');
export type WorkerId = z.infer<typeof workerIdSchema>;

/**
 * Result type for expected failures in domain/application layers.
 * Cannot be expressed as a Zod schema due to generics -- hand-written.
 */
export type Result<T, E extends Error = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error };
}
