import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ManifestWriter } from '@ai-orchestrator/ports';
import type { RunManifest } from '@ai-orchestrator/schemas';

import { MANIFEST_FILENAME } from './constants';
import { serializeManifest } from './manifest-serializer';

/** Filesystem-backed implementation of ManifestWriter. */
export class FilesystemManifestWriter implements ManifestWriter {
  constructor(private readonly baseDir: string) {}

  write(runId: string, manifest: RunManifest): void {
    const runDir = join(this.baseDir, runId);
    mkdirSync(runDir, { recursive: true });

    const filePath = join(runDir, MANIFEST_FILENAME);
    const content = serializeManifest(manifest);
    writeFileSync(filePath, content, 'utf8');
  }
}
