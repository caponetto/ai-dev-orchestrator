import { createPatch } from 'diff';

export interface DiffResult {
  readonly kind: 'unchanged' | 'changed' | 'new';
  readonly diff?: string;
  readonly content?: string;
}

export class ArtifactDiffGenerator {
  computeDiff(previous: string | undefined, current: string): DiffResult {
    if (previous === undefined) {
      return { kind: 'new', content: current };
    }

    if (previous === current) {
      return { kind: 'unchanged' };
    }

    const patch = createPatch('artifact', previous, current, '', '', { context: 3 });

    const lines = patch.split('\n');
    const headerEnd = lines.findIndex((l, i) => i > 0 && l.startsWith('@@'));
    const compactDiff = headerEnd > 0 ? lines.slice(headerEnd).join('\n') : patch;

    return { kind: 'changed', diff: compactDiff };
  }
}
