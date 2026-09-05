import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ArtifactType } from '@ai-dev-orchestrator/schemas';

const VERSION_PATTERN = /_v(\d+)\.\w+$/;

/** Manages monotonically increasing version numbers for artifacts. */
export class VersionManager {
  constructor(private readonly artifactsDir: string) {}

  /** Get the next version number for an artifact name. Scans disk for existing versions. */
  nextVersion(type: ArtifactType, name: string): number {
    const latest = this.latestVersion(type, name);
    return latest === null ? 1 : latest + 1;
  }

  /** Get the highest version number for an artifact name. Returns null if none exist. */
  latestVersion(type: ArtifactType, name: string): number | null {
    const versions = this.listVersions(type, name);
    return versions.length === 0 ? null : (versions[versions.length - 1] ?? null);
  }

  /** List all version numbers for an artifact name, sorted ascending. */
  listVersions(type: ArtifactType, name: string): number[] {
    const typeDir = join(this.artifactsDir, type);
    if (!existsSync(typeDir)) {
      return [];
    }

    const files = readdirSync(typeDir);
    const versions: number[] = [];

    for (const file of files) {
      if (!file.startsWith(`${name}_v`)) {
        continue;
      }
      if (file.endsWith('.meta.yaml')) {
        continue;
      }
      const match = VERSION_PATTERN.exec(file);
      if (match?.[1]) {
        versions.push(Number(match[1]));
      }
    }

    return versions.sort((a, b) => a - b);
  }
}
