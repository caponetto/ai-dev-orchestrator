import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CACHE_DIR = join(homedir(), '.ai', 'cache', 'scip');
const INDEX_TIMEOUT_MS = 120_000;

export interface ScipIndexerOptions {
  readonly cacheDir?: string;
}

export class ScipIndexer {
  private readonly cacheDir: string;

  constructor(options?: ScipIndexerOptions) {
    this.cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
    mkdirSync(this.cacheDir, { recursive: true });
  }

  getCachePath(repoRoot: string): string {
    const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
    return join(this.cacheDir, `${hash}.scip`);
  }

  isIndexed(repoRoot: string): boolean {
    return existsSync(this.getCachePath(repoRoot));
  }

  index(repoRoot: string): string {
    const outputPath = this.getCachePath(repoRoot);

    execFileSync('scip-typescript', ['index', '--pnpm-workspaces', '--output', outputPath], {
      cwd: repoRoot,
      timeout: INDEX_TIMEOUT_MS,
      stdio: 'pipe',
    });

    return outputPath;
  }
}
