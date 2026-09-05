import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectContextStore } from '@ai-dev-orchestrator/ports';
import type {
  ContextCategory,
  ContextDocument,
  ContextFragment,
  ContextQuery,
} from '@ai-dev-orchestrator/schemas';

import { ContextReadError, ContextStoreInitError, ContextWriteError } from '../domain/errors';

const CATEGORY_FILES: Record<ContextCategory, string> = {
  codebase: 'codebase.json',
  run_history: 'run_history.json',
  preferences: 'preferences.json',
  analytics: 'analytics.json',
};

export class FilesystemProjectContextStore implements ProjectContextStore {
  private readonly baseDir: string;
  private projectDir: string | null = null;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  getProjectHash(projectRoot: string): string {
    return createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
  }

  async initialize(projectRoot: string): Promise<void> {
    const hash = this.getProjectHash(projectRoot);
    this.projectDir = join(this.baseDir, 'projects', hash);

    try {
      await mkdir(this.projectDir, { recursive: true });
    } catch (err) {
      throw new ContextStoreInitError(
        `Failed to initialize context store at ${this.projectDir}: ${String(err)}`,
      );
    }
  }

  async read(category: ContextCategory): Promise<ContextDocument | null> {
    const dir = this.ensureInitialized();
    const filePath = join(dir, CATEGORY_FILES[category]);

    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as ContextDocument;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw new ContextReadError(`Failed to read context category '${category}': ${String(err)}`);
    }
  }

  async write(category: ContextCategory, content: ContextDocument): Promise<void> {
    const dir = this.ensureInitialized();
    const filePath = join(dir, CATEGORY_FILES[category]);
    const tmpPath = `${filePath}.tmp`;

    try {
      const serialized = JSON.stringify(content, null, 2);
      await writeFile(tmpPath, serialized, 'utf-8');
      await rename(tmpPath, filePath);
    } catch (err) {
      throw new ContextWriteError(`Failed to write context category '${category}': ${String(err)}`);
    }
  }

  async query(filter: ContextQuery): Promise<readonly ContextFragment[]> {
    this.ensureInitialized();
    const categories =
      filter.categories ?? (['codebase', 'run_history', 'preferences', 'analytics'] as const);
    const fragments: ContextFragment[] = [];

    for (const category of categories) {
      const doc = await this.read(category);
      if (!doc) {
        continue;
      }

      const content = this.extractContent(category, doc);
      if (content) {
        fragments.push({
          category,
          content,
          relevanceScore: 1.0,
        });
      }
    }

    if (filter.maxTokens !== undefined) {
      return this.truncateToTokenBudget(fragments, filter.maxTokens);
    }

    return fragments;
  }

  private extractContent(category: ContextCategory, doc: ContextDocument): string | null {
    const content = doc.content;
    if (!content || typeof content !== 'object') {
      return null;
    }

    switch (category) {
      case 'codebase': {
        const ctx = content as Record<string, unknown>;
        const parts: string[] = [];
        if (ctx['architecture'] && typeof ctx['architecture'] === 'object') {
          const arch = ctx['architecture'] as Record<string, unknown>;
          if (typeof arch['summary'] === 'string') {
            parts.push(`## Architecture\n${arch['summary']}`);
          }
        }
        if (Array.isArray(ctx['conventions'])) {
          const rules = ctx['conventions']
            .map((c: Record<string, unknown>) => `- ${String(c['rule'])}`)
            .join('\n');
          if (rules) {
            parts.push(`## Conventions\n${rules}`);
          }
        }
        return parts.length > 0 ? parts.join('\n\n') : null;
      }
      case 'run_history': {
        const ctx = content as Record<string, unknown>;
        if (Array.isArray(ctx['runs']) && ctx['runs'].length > 0) {
          const summaries = ctx['runs']
            .slice(-5)
            .map(
              (r: Record<string, unknown>) =>
                `- [${String(r['outcome'])}] ${String(r['taskSummary'])}`,
            )
            .join('\n');
          return `## Recent Runs\n${summaries}`;
        }
        return null;
      }
      case 'preferences': {
        const ctx = content as Record<string, unknown>;
        const parts: string[] = [];
        if (Array.isArray(ctx['failurePatterns']) && ctx['failurePatterns'].length > 0) {
          const patterns = ctx['failurePatterns']
            .map(
              (p: Record<string, unknown>) =>
                `- ${String(p['pattern'])} (freq: ${String(p['frequency'])})`,
            )
            .join('\n');
          parts.push(`## Known Failure Patterns\n${patterns}`);
        }
        return parts.length > 0 ? parts.join('\n\n') : null;
      }
      case 'analytics': {
        return null;
      }
    }
  }

  private truncateToTokenBudget(
    fragments: ContextFragment[],
    maxTokens: number,
  ): ContextFragment[] {
    const APPROX_CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
    let totalChars = 0;
    const result: ContextFragment[] = [];

    for (const fragment of fragments) {
      if (totalChars + fragment.content.length > maxChars) {
        const remaining = maxChars - totalChars;
        if (remaining > 100) {
          result.push({ ...fragment, content: fragment.content.slice(0, remaining) });
        }
        break;
      }
      totalChars += fragment.content.length;
      result.push(fragment);
    }

    return result;
  }

  private ensureInitialized(): string {
    if (!this.projectDir) {
      throw new ContextStoreInitError('Context store not initialized. Call initialize() first.');
    }
    return this.projectDir;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
