import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactConsistencyChecker } from '../artifact-consistency-checker';

describe('ArtifactConsistencyChecker', () => {
  let dir: string;
  let checker: ArtifactConsistencyChecker;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `artifact-check-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
    );
    mkdirSync(dir, { recursive: true });
    checker = new ArtifactConsistencyChecker();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('verify', () => {
    it('does not follow directory symlinks or delete files outside the artifact tree', () => {
      const outside = mkdtempSync(join(tmpdir(), 'artifact-outside-'));
      try {
        writeFileSync(join(outside, 'keep.md'), 'unrelated file');
        symlinkSync(outside, join(dir, 'linked'), 'dir');
        expect(checker.repair(dir).deletedFiles).toEqual([]);
        expect(existsSync(join(outside, 'keep.md'))).toBe(true);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('recognizes production nested type directories and repairs only true orphan files', () => {
      const typeDir = join(dir, 'plan');
      mkdirSync(typeDir);
      writeFileSync(join(typeDir, 'plan_v1.md'), 'committed content');
      writeFileSync(join(typeDir, 'plan_v1.meta.yaml'), 'type: plan');
      expect(checker.verify(dir)).toEqual({
        consistent: true,
        orphanContent: [],
        orphanSidecars: [],
      });

      writeFileSync(join(typeDir, 'plan_v2.md'), 'incomplete content');
      writeFileSync(join(typeDir, 'plan_v3.meta.yaml'), 'type: plan');
      expect(checker.verify(dir)).toEqual({
        consistent: false,
        orphanContent: [join('plan', 'plan_v2.md')],
        orphanSidecars: [join('plan', 'plan_v3.meta.yaml')],
      });
      expect(checker.repair(dir).deletedFiles).toEqual([
        join('plan', 'plan_v2.md'),
        join('plan', 'plan_v3.meta.yaml'),
      ]);
      expect(existsSync(join(typeDir, 'plan_v1.md'))).toBe(true);
      expect(existsSync(join(typeDir, 'plan_v1.meta.yaml'))).toBe(true);
      expect(checker.verify(dir).consistent).toBe(true);
    });

    it('reports consistent for empty directory', () => {
      const report = checker.verify(dir);
      expect(report.orphanContent).toEqual([]);
      expect(report.orphanSidecars).toEqual([]);
      expect(report.consistent).toBe(true);
    });

    it('reports consistent for non-existent directory', () => {
      const nonExistent = join(tmpdir(), `does-not-exist-${String(Date.now())}`);
      const report = checker.verify(nonExistent);
      expect(report.consistent).toBe(true);
      expect(report.orphanContent).toEqual([]);
      expect(report.orphanSidecars).toEqual([]);
    });

    it('reports consistent for matched content and sidecar', () => {
      writeFileSync(join(dir, 'spec-v1.md'), 'content');
      writeFileSync(join(dir, 'spec-v1.md.meta.yaml'), 'type: specification');
      const report = checker.verify(dir);
      expect(report.consistent).toBe(true);
    });

    it('reports consistent for multiple matched pairs', () => {
      writeFileSync(join(dir, 'spec-v1.md'), 'content1');
      writeFileSync(join(dir, 'spec-v1.md.meta.yaml'), 'type: spec');
      writeFileSync(join(dir, 'plan-v1.md'), 'content2');
      writeFileSync(join(dir, 'plan-v1.md.meta.yaml'), 'type: plan');
      const report = checker.verify(dir);
      expect(report.consistent).toBe(true);
      expect(report.orphanContent).toEqual([]);
      expect(report.orphanSidecars).toEqual([]);
    });

    it('detects content without sidecar', () => {
      writeFileSync(join(dir, 'spec-v1.md'), 'content');
      const report = checker.verify(dir);
      expect(report.orphanContent).toContain('spec-v1.md');
      expect(report.consistent).toBe(false);
    });

    it('detects sidecar without content', () => {
      writeFileSync(join(dir, 'spec-v1.md.meta.yaml'), 'type: specification');
      const report = checker.verify(dir);
      expect(report.orphanSidecars).toContain('spec-v1.md.meta.yaml');
      expect(report.consistent).toBe(false);
    });

    it('detects mixed orphans alongside consistent pairs', () => {
      writeFileSync(join(dir, 'good.md'), 'content');
      writeFileSync(join(dir, 'good.md.meta.yaml'), 'type: spec');
      writeFileSync(join(dir, 'orphan-content.md'), 'lost');
      writeFileSync(join(dir, 'orphan-sidecar.md.meta.yaml'), 'type: ghost');

      const report = checker.verify(dir);
      expect(report.consistent).toBe(false);
      expect(report.orphanContent).toContain('orphan-content.md');
      expect(report.orphanSidecars).toContain('orphan-sidecar.md.meta.yaml');
    });
  });

  describe('repair', () => {
    it('deletes orphan content files', () => {
      writeFileSync(join(dir, 'orphan.md'), 'content');
      const result = checker.repair(dir);
      expect(result.deletedFiles).toContain('orphan.md');
      expect(existsSync(join(dir, 'orphan.md'))).toBe(false);
    });

    it('deletes orphan sidecars', () => {
      writeFileSync(join(dir, 'orphan.md.meta.yaml'), 'type: spec');
      const result = checker.repair(dir);
      expect(result.deletedFiles).toContain('orphan.md.meta.yaml');
      expect(existsSync(join(dir, 'orphan.md.meta.yaml'))).toBe(false);
    });

    it('preserves consistent pairs during repair', () => {
      writeFileSync(join(dir, 'good.md'), 'content');
      writeFileSync(join(dir, 'good.md.meta.yaml'), 'type: spec');
      writeFileSync(join(dir, 'orphan.md'), 'lost');

      const result = checker.repair(dir);
      expect(result.deletedFiles).toContain('orphan.md');
      expect(existsSync(join(dir, 'good.md'))).toBe(true);
      expect(existsSync(join(dir, 'good.md.meta.yaml'))).toBe(true);
    });

    it('produces warnings for each deleted file', () => {
      writeFileSync(join(dir, 'orphan1.md'), 'content1');
      writeFileSync(join(dir, 'orphan2.md'), 'content2');

      const result = checker.repair(dir);
      expect(result.warnings.length).toBe(2);
      expect(result.warnings.every((w) => w.includes('Deleted orphan file'))).toBe(true);
    });

    it('returns empty results when directory is consistent', () => {
      writeFileSync(join(dir, 'spec.md'), 'content');
      writeFileSync(join(dir, 'spec.md.meta.yaml'), 'type: spec');

      const result = checker.repair(dir);
      expect(result.deletedFiles).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });
});
