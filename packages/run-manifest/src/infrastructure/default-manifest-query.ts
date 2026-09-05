import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ManifestFilter, ManifestQuery } from '@ai-dev-orchestrator/ports';
import type { RunManifest } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

import { MANIFEST_FILENAME } from './constants';

/** Filesystem-backed implementation of ManifestQuery. */
export class DefaultManifestQuery implements ManifestQuery {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  get(runId: string): RunManifest | null {
    const filePath = join(this.baseDir, runId, MANIFEST_FILENAME);
    return this.readManifestFile(filePath);
  }

  list(filter?: ManifestFilter): RunManifest[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const entries = readdirSync(this.baseDir, { withFileTypes: true });
    const manifests: RunManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = join(this.baseDir, entry.name, MANIFEST_FILENAME);
      const manifest = this.readManifestFile(filePath);
      if (manifest && this.matchesFilter(manifest, filter)) {
        manifests.push(manifest);
      }
    }

    return manifests;
  }

  private readManifestFile(filePath: string): RunManifest | null {
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const content = readFileSync(filePath, 'utf8');
      return parse(content) as RunManifest;
    } catch {
      return null;
    }
  }

  private matchesFilter(manifest: RunManifest, filter?: ManifestFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.status && manifest.status !== filter.status) {
      return false;
    }
    if (filter.repository && manifest.repository !== filter.repository) {
      return false;
    }
    if (filter.after && manifest.timing.startedAt < filter.after) {
      return false;
    }
    if (filter.before && manifest.timing.startedAt > filter.before) {
      return false;
    }
    return true;
  }
}
