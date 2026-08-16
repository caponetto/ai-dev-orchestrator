import type { SpecificationValidator } from '@ai-orchestrator/ports';
import type {
  CanonicalSpecification,
  CompletenessResult,
  SpecificationValidationError,
  SpecificationValidationResult,
  SpecificationValidationWarning,
} from '@ai-orchestrator/schemas';
import { COMPLETENESS_WEIGHTS } from '@ai-orchestrator/schemas';
import { z } from 'zod';

const structureSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().min(1),
    title: z.string().min(1),
    businessGoal: z.string().min(1),
    stakeholders: z.array(z.unknown()),
    assumptions: z.array(z.unknown()),
    constraints: z.array(z.unknown()),
    functionalRequirements: z.array(z.unknown()),
    nonFunctionalRequirements: z.array(z.unknown()),
    acceptanceCriteria: z.array(z.unknown()),
    risks: z.array(z.unknown()),
    dependencies: z.array(z.unknown()),
    definitionOfDone: z.array(z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .loose();

const STRUCTURE_RULES: Readonly<Record<string, { message: string; rule: string }>> = {
  id: { message: 'Specification id is required', rule: 'required' },
  version: { message: 'Version must be a positive integer', rule: 'positive-integer' },
  title: { message: 'Title is required', rule: 'required' },
  businessGoal: { message: 'Business goal is required', rule: 'required' },
  stakeholders: { message: 'Stakeholders must be an array', rule: 'type' },
  assumptions: { message: 'Assumptions must be an array', rule: 'type' },
  constraints: { message: 'Constraints must be an array', rule: 'type' },
  functionalRequirements: {
    message: 'Functional requirements must be an array',
    rule: 'type',
  },
  nonFunctionalRequirements: {
    message: 'Non-functional requirements must be an array',
    rule: 'type',
  },
  acceptanceCriteria: { message: 'Acceptance criteria must be an array', rule: 'type' },
  risks: { message: 'Risks must be an array', rule: 'type' },
  dependencies: { message: 'Dependencies must be an array', rule: 'type' },
  definitionOfDone: { message: 'Definition of done must be an array', rule: 'type' },
  createdAt: { message: 'Created timestamp is required', rule: 'required' },
  updatedAt: { message: 'Updated timestamp is required', rule: 'required' },
};

export class DefaultSpecificationValidator implements SpecificationValidator {
  validateStructure(spec: CanonicalSpecification): SpecificationValidationResult {
    const errors: SpecificationValidationError[] = [];
    const warnings: SpecificationValidationWarning[] = [];

    const result = structureSchema.safeParse(spec);
    if (!result.success) {
      for (const zi of result.error.issues) {
        const field = String(zi.path[0] ?? '');
        const mapped = STRUCTURE_RULES[field];
        errors.push({ field, message: mapped.message, rule: mapped.rule });
      }
    }

    if (spec.functionalRequirements.length === 0) {
      warnings.push({
        field: 'functionalRequirements',
        message: 'No functional requirements defined',
        suggestion: 'Add at least one "must" priority functional requirement',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  validateSemantics(spec: CanonicalSpecification): SpecificationValidationResult {
    const errors: SpecificationValidationError[] = [];
    const warnings: SpecificationValidationWarning[] = [];

    const frIds = new Set<string>();
    for (const fr of spec.functionalRequirements) {
      if (frIds.has(fr.id)) {
        errors.push({
          field: 'functionalRequirements',
          message: `Duplicate functional requirement ID: ${fr.id}`,
          rule: 'unique-id',
        });
      }
      frIds.add(fr.id);
    }

    const nfrIds = new Set<string>();
    for (const nfr of spec.nonFunctionalRequirements) {
      if (nfrIds.has(nfr.id)) {
        errors.push({
          field: 'nonFunctionalRequirements',
          message: `Duplicate non-functional requirement ID: ${nfr.id}`,
          rule: 'unique-id',
        });
      }
      nfrIds.add(nfr.id);
    }

    const acIds = new Set<string>();
    for (const ac of spec.acceptanceCriteria) {
      if (acIds.has(ac.id)) {
        errors.push({
          field: 'acceptanceCriteria',
          message: `Duplicate acceptance criterion ID: ${ac.id}`,
          rule: 'unique-id',
        });
      }
      acIds.add(ac.id);

      for (const reqId of ac.requirementIds) {
        if (!frIds.has(reqId)) {
          errors.push({
            field: 'acceptanceCriteria',
            message: `Acceptance criterion ${ac.id} references non-existent requirement ${reqId}`,
            rule: 'valid-reference',
          });
        }
      }
    }

    const riskIds = new Set<string>();
    for (const risk of spec.risks) {
      if (riskIds.has(risk.id)) {
        errors.push({
          field: 'risks',
          message: `Duplicate risk ID: ${risk.id}`,
          rule: 'unique-id',
        });
      }
      riskIds.add(risk.id);
    }

    const depIds = new Set<string>();
    for (const dep of spec.dependencies) {
      if (depIds.has(dep.id)) {
        errors.push({
          field: 'dependencies',
          message: `Duplicate dependency ID: ${dep.id}`,
          rule: 'unique-id',
        });
      }
      depIds.add(dep.id);
    }

    const assumptionIds = new Set<string>();
    for (const a of spec.assumptions) {
      if (assumptionIds.has(a.id)) {
        errors.push({
          field: 'assumptions',
          message: `Duplicate assumption ID: ${a.id}`,
          rule: 'unique-id',
        });
      }
      assumptionIds.add(a.id);
    }

    const constraintIds = new Set<string>();
    for (const c of spec.constraints) {
      if (constraintIds.has(c.id)) {
        errors.push({
          field: 'constraints',
          message: `Duplicate constraint ID: ${c.id}`,
          rule: 'unique-id',
        });
      }
      constraintIds.add(c.id);
    }

    for (const fr of spec.functionalRequirements) {
      if (fr.dependencies) {
        for (const depId of fr.dependencies) {
          if (depId === fr.id) {
            errors.push({
              field: 'functionalRequirements',
              message: `Requirement ${fr.id} references itself as a dependency`,
              rule: 'no-self-reference',
            });
          }
          if (!frIds.has(depId)) {
            warnings.push({
              field: 'functionalRequirements',
              message: `Requirement ${fr.id} depends on unknown requirement ${depId}`,
              suggestion: `Verify that requirement ${depId} exists`,
            });
          }
        }
      }
    }

    const hasMust = spec.functionalRequirements.some((fr) => fr.priority === 'must');
    if (spec.functionalRequirements.length > 0 && !hasMust) {
      warnings.push({
        field: 'functionalRequirements',
        message: 'No functional requirements have "must" priority',
        suggestion: 'At least one requirement should be marked as "must"',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  validateCompleteness(spec: CanonicalSpecification): CompletenessResult {
    const missingFields: string[] = [];
    const emptyFields: string[] = [];
    const fieldScores: Record<string, number> = {};

    const scoreField = (
      name: string,
      value: unknown,
      isComplete?: (v: unknown) => boolean,
    ): void => {
      if (value === undefined || value === null) {
        fieldScores[name] = 0;
        missingFields.push(name);
        return;
      }

      if (typeof value === 'string') {
        if (value.length === 0) {
          fieldScores[name] = 0;
          emptyFields.push(name);
        } else {
          fieldScores[name] = 1;
        }
        return;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          fieldScores[name] = 0;
          emptyFields.push(name);
        } else if (isComplete && !isComplete(value)) {
          fieldScores[name] = 0.5;
        } else {
          fieldScores[name] = 1;
        }
        return;
      }

      fieldScores[name] = 1;
    };

    scoreField('title', spec.title);
    scoreField('businessGoal', spec.businessGoal);
    scoreField('stakeholders', spec.stakeholders);
    scoreField('assumptions', spec.assumptions);
    scoreField('constraints', spec.constraints);
    scoreField('functionalRequirements', spec.functionalRequirements, (v) => {
      const reqs = v as readonly { acceptanceCriteria: readonly string[] }[];
      return reqs.every((r) => r.acceptanceCriteria.length > 0);
    });
    scoreField('nonFunctionalRequirements', spec.nonFunctionalRequirements);
    scoreField('acceptanceCriteria', spec.acceptanceCriteria);
    scoreField('risks', spec.risks);
    scoreField('dependencies', spec.dependencies);
    scoreField('definitionOfDone', spec.definitionOfDone);

    let score = 0;
    for (const [field, weight] of Object.entries(COMPLETENESS_WEIGHTS)) {
      score += (fieldScores[field] ?? 0) * weight;
    }

    return {
      score: Math.round(score * 100) / 100,
      missingFields,
      emptyFields,
      fieldScores,
    };
  }
}
