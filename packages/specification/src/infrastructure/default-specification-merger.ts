import type { SpecificationMerger } from '@ai-dev-orchestrator/ports';
import type {
  CanonicalSpecification,
  MergeConflict,
  MergeResult,
  MergeStrategy,
} from '@ai-dev-orchestrator/schemas';

import { createSpecificationId } from '../domain/types';

export class DefaultSpecificationMerger implements SpecificationMerger {
  merge(specs: readonly CanonicalSpecification[], strategy: MergeStrategy): MergeResult {
    if (specs.length === 0) {
      const now = new Date().toISOString();
      return {
        merged: {
          id: createSpecificationId(),
          version: 1,
          title: '',
          businessGoal: '',
          stakeholders: [],
          assumptions: [],
          constraints: [],
          functionalRequirements: [],
          nonFunctionalRequirements: [],
          acceptanceCriteria: [],
          risks: [],
          dependencies: [],
          definitionOfDone: [],
          sources: [],
          createdAt: now,
          updatedAt: now,
        },
        conflicts: [],
      };
    }

    if (specs.length === 1) {
      return { merged: { ...specs[0] }, conflicts: [] };
    }

    const conflicts: MergeConflict[] = [];
    const now = new Date().toISOString();

    const resolveScalar = (
      field: string,
      values: readonly CanonicalSpecification[],
      getter: (s: CanonicalSpecification) => string,
    ): string => {
      const unique = [...new Set(values.map(getter).filter((v) => v.length > 0))];
      if (unique.length <= 1) {
        return unique[0] ?? '';
      }

      if (strategy.scalarConflict === 'flag-conflict') {
        conflicts.push({
          field,
          values: unique.map((v, i) => ({
            source: values[i]?.id ?? `spec-${String(i)}`,
            value: v,
          })),
          resolution: 'flagged',
        });
        return unique[0];
      }

      const resolved =
        strategy.scalarConflict === 'last-wins' ? unique[unique.length - 1] : unique[0];
      conflicts.push({
        field,
        values: unique.map((v, i) => ({ source: values[i]?.id ?? `spec-${String(i)}`, value: v })),
        resolution: 'auto-resolved',
        resolvedValue: resolved,
      });
      return resolved;
    };

    const mergeArrays = <T extends { readonly id: string }>(
      arrays: readonly (readonly T[])[],
    ): readonly T[] => {
      if (strategy.arrayMerge === 'concatenate') {
        return arrays.flat();
      }

      if (!strategy.deduplication) {
        return arrays.flat();
      }

      const seen = new Set<string>();
      const result: T[] = [];
      for (const arr of arrays) {
        for (const item of arr) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            result.push(item);
          }
        }
      }
      return result;
    };

    const mergeStringArrays = (arrays: readonly (readonly string[])[]): readonly string[] => {
      if (strategy.arrayMerge === 'concatenate') {
        return arrays.flat();
      }
      return strategy.deduplication ? [...new Set(arrays.flat())] : arrays.flat();
    };

    const title = resolveScalar('title', specs, (s) => s.title);
    const businessGoal = resolveScalar('businessGoal', specs, (s) => s.businessGoal);

    const merged: CanonicalSpecification = {
      id: createSpecificationId(),
      version: 1,
      title,
      businessGoal,
      stakeholders: specs.flatMap((s) => s.stakeholders),
      assumptions: mergeArrays(specs.map((s) => s.assumptions)),
      constraints: mergeArrays(specs.map((s) => s.constraints)),
      functionalRequirements: mergeArrays(specs.map((s) => s.functionalRequirements)),
      nonFunctionalRequirements: mergeArrays(specs.map((s) => s.nonFunctionalRequirements)),
      acceptanceCriteria: mergeArrays(specs.map((s) => s.acceptanceCriteria)),
      risks: mergeArrays(specs.map((s) => s.risks)),
      dependencies: mergeArrays(specs.map((s) => s.dependencies)),
      definitionOfDone: mergeStringArrays(specs.map((s) => s.definitionOfDone)),
      sources: specs.flatMap((s) => s.sources),
      createdAt: now,
      updatedAt: now,
    };

    return { merged, conflicts };
  }
}
