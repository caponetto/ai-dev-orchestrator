import { describe, expect, it } from 'vitest';

import {
  AI_CONFIG_DIR_NAME,
  ARTIFACTS_DIR_NAME,
  err,
  ok,
  RUNS_DIR_NAME,
  runIdSchema,
  TMP_DIR_NAME,
  MEDIA_FILE_EXTENSIONS,
  MEDIA_MIME_TYPES,
  VIDEOS_DIR_NAME,
  workerIdSchema,
} from '../shared';

describe('runIdSchema', () => {
  it('accepts a string', () => {
    expect(runIdSchema.safeParse('run-123').success).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(runIdSchema.safeParse(123).success).toBe(false);
    expect(runIdSchema.safeParse(null).success).toBe(false);
  });
});

describe('workerIdSchema', () => {
  it('accepts a string', () => {
    expect(workerIdSchema.safeParse('w-42').success).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(workerIdSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('ok / err helpers', () => {
  it('creates an ok result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('creates an err result', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('fail');
    }
  });
});

describe('filesystem constants', () => {
  it('AI_CONFIG_DIR_NAME is .ai', () => {
    expect(AI_CONFIG_DIR_NAME).toBe('.ai');
  });

  it('RUNS_DIR_NAME is runs', () => {
    expect(RUNS_DIR_NAME).toBe('runs');
  });

  it('ARTIFACTS_DIR_NAME is artifacts', () => {
    expect(ARTIFACTS_DIR_NAME).toBe('artifacts');
  });

  it('VIDEOS_DIR_NAME is videos', () => {
    expect(VIDEOS_DIR_NAME).toBe('videos');
  });

  it('TMP_DIR_NAME is tmp', () => {
    expect(TMP_DIR_NAME).toBe('tmp');
  });

  it('MEDIA_FILE_EXTENSIONS contains expected formats', () => {
    expect(MEDIA_FILE_EXTENSIONS).toContain('.webm');
    expect(MEDIA_FILE_EXTENSIONS).toContain('.mp4');
    expect(MEDIA_FILE_EXTENSIONS).toContain('.png');
    expect(MEDIA_FILE_EXTENSIONS).toContain('.jpg');
    expect(MEDIA_FILE_EXTENSIONS.length).toBeGreaterThanOrEqual(6);
  });

  it('MEDIA_MIME_TYPES maps extensions to correct MIME types', () => {
    expect(MEDIA_MIME_TYPES['.webm']).toBe('video/webm');
    expect(MEDIA_MIME_TYPES['.mp4']).toBe('video/mp4');
    expect(MEDIA_MIME_TYPES['.png']).toBe('image/png');
    expect(MEDIA_MIME_TYPES['.jpg']).toBe('image/jpeg');
  });
});
