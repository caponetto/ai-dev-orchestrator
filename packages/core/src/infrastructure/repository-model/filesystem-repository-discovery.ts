import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { RepositoryDiscovery } from '@ai-orchestrator/ports';
import { AI_CONFIG_DIR_NAME } from '@ai-orchestrator/schemas';
import type { DiscoveryResult } from '@ai-orchestrator/schemas';

export interface FilesystemRepositoryDiscoveryOptions {
  /** Override for tests; defaults to `~/.ai`. */
  readonly globalAiDir?: string;
}

/**
 * Discovers the target git repository from `cwd` and the global orchestrator
 * config directory at `~/.ai/`.
 *
 * Configuration is global-only — there is no per-project `.ai/` directory.
 */
export class FilesystemRepositoryDiscovery implements RepositoryDiscovery {
  private readonly globalAiDir: string;

  constructor(options?: FilesystemRepositoryDiscoveryOptions) {
    this.globalAiDir = options?.globalAiDir ?? join(homedir(), AI_CONFIG_DIR_NAME);
  }

  discover(cwd: string): DiscoveryResult {
    const absoluteCwd = resolve(cwd);
    const errors: string[] = [];

    const aiConfigDir =
      existsSync(this.globalAiDir) && statSync(this.globalAiDir).isDirectory()
        ? this.globalAiDir
        : undefined;

    let gitRoot: string | undefined;
    let repoRoot: string | undefined;
    let current = absoluteCwd;

    for (;;) {
      const gitDir = join(current, '.git');
      if (existsSync(gitDir) && (statSync(gitDir).isDirectory() || statSync(gitDir).isFile())) {
        gitRoot = gitDir;
        repoRoot = current;
        break;
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    if (aiConfigDir && !gitRoot) {
      errors.push('No .git/ directory found. Git integration features will be unavailable.');
    }

    return {
      found: aiConfigDir !== undefined,
      repoRoot,
      aiConfigDir,
      gitRoot,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
