import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const META_SUFFIX = '.meta.yaml';

export interface ConsistencyReport {
  readonly consistent: boolean;
  readonly orphanContent: readonly string[];
  readonly orphanSidecars: readonly string[];
}

export interface RepairResult {
  readonly deletedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export class ArtifactConsistencyChecker {
  verify(artifactsDir: string): ConsistencyReport {
    if (!existsSync(artifactsDir)) {
      return { consistent: true, orphanContent: [], orphanSidecars: [] };
    }

    const files = this.collectFiles(artifactsDir);
    const sidecars = new Set(files.filter((f) => f.endsWith(META_SUFFIX)));
    const contentFiles = files.filter((f) => !f.endsWith(META_SUFFIX));

    const orphanContent: string[] = [];
    const orphanSidecars: string[] = [];

    for (const content of contentFiles) {
      const expectedSidecar = content.replace(/\.md$/, '') + META_SUFFIX;
      const legacySidecar = `${content}${META_SUFFIX}`;
      if (sidecars.has(expectedSidecar)) {
        sidecars.delete(expectedSidecar);
      } else if (sidecars.has(legacySidecar)) {
        sidecars.delete(legacySidecar);
      } else {
        orphanContent.push(content);
      }
    }

    for (const sidecar of sidecars) {
      orphanSidecars.push(sidecar);
    }

    return {
      consistent: orphanContent.length === 0 && orphanSidecars.length === 0,
      orphanContent,
      orphanSidecars,
    };
  }

  private collectFiles(root: string, prefix = ''): string[] {
    return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
      const path = join(prefix, entry.name);
      if (entry.isDirectory()) {
        return this.collectFiles(root, path);
      }
      // Do not follow links into directories outside the artifact tree during repair.
      return entry.isFile() ? [path] : [];
    });
  }

  repair(artifactsDir: string): RepairResult {
    const report = this.verify(artifactsDir);
    const deletedFiles: string[] = [];
    const warnings: string[] = [];

    for (const orphan of [...report.orphanContent, ...report.orphanSidecars]) {
      try {
        unlinkSync(join(artifactsDir, orphan));
        deletedFiles.push(orphan);
        warnings.push(`Deleted orphan file: ${orphan}`);
      } catch {
        warnings.push(`Failed to delete orphan file: ${orphan}`);
      }
    }

    return { deletedFiles, warnings };
  }
}
