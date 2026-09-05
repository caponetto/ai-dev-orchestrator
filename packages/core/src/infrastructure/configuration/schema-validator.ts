import type { ValidationIssue, ValidationReport } from '@ai-dev-orchestrator/ports';
import type { LogLevel, MergedConfiguration, RunnerDefinition } from '@ai-dev-orchestrator/schemas';
import { DISPATCH_TYPES, workflowConfigSchema } from '@ai-dev-orchestrator/schemas';
import { isObject } from '@ai-dev-orchestrator/utils';
import { z } from 'zod';

const roleAssignmentSchema = z
  .object({
    model: z.string().min(1),
    dispatchType: z.enum(DISPATCH_TYPES).optional(),
    runner: z.string().min(1).optional(),
    agentConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const rolesSchema = z
  .object({
    assignments: z.record(z.string(), roleAssignmentSchema),
  })
  .loose();

const budgetSchema = z
  .object({
    maxTokensPerRun: z.number().int().positive().nullable().optional(),
    alertThresholds: z
      .array(
        z
          .number()
          .min(0, { message: 'Threshold must be >= 0' })
          .max(1, { message: 'Threshold must be <= 1' }),
      )
      .optional(),
  })
  .loose();

const governanceSchema = z
  .object({
    iterationLimits: z.record(z.string(), z.unknown()),
    qualityGates: z.record(z.string(), z.unknown()),
    budget: budgetSchema.optional(),
  })
  .loose();

const validLogLevels = ['debug', 'info', 'warn', 'error'] as const satisfies readonly LogLevel[];

const runtimeSchema = z
  .object({
    logLevel: z.enum(validLogLevels),
    reportOutputPath: z.string().min(1).optional(),
  })
  .loose();

const configSchema = z
  .object({
    workflow: workflowConfigSchema.loose(),
    roles: rolesSchema,
    governance: governanceSchema,
    runtime: runtimeSchema,
  })
  .loose();

const SECTION_HELP: Readonly<Record<string, string>> = {
  workflow: 'Add a workflow section with at least name and version fields',
  roles: 'Add a roles section with an assignments map',
  governance: 'Add governance section with iterationLimits and qualityGates',
  runtime: 'Add runtime section with logLevel',
};

const FIELD_HELP: Readonly<Record<string, string>> = {
  'roles.assignments': 'Add role assignments mapping roles to model pairs',
  'workflow.globalTransitionLimit':
    'Set globalTransitionLimit to a positive integer (default: 200)',
  'runtime.logLevel': 'Set logLevel to debug, info, warn, or error',
};

export function validateConfiguration(
  config: MergedConfiguration | Record<string, unknown>,
  sourceFile = '<merged>',
  runnerRegistry?: readonly RunnerDefinition[],
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const raw = config as Record<string, unknown>;

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    for (const zi of result.error.issues) {
      errors.push(mapZodIssue(zi, sourceFile));
    }
  }

  validateExcludeRoles(raw, sourceFile, errors);
  if (runnerRegistry && runnerRegistry.length > 0) {
    validateRunnerAssignments(raw, sourceFile, runnerRegistry, errors);
  }
  collectWarnings(raw, sourceFile, warnings);

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    warnings,
    effectiveConfig:
      valid && result.success ? (result.data as unknown as MergedConfiguration) : undefined,
  };
}

function mapZodIssue(zi: z.ZodError['issues'][number], file: string): ValidationIssue {
  const ziAny = zi as unknown as Record<string, unknown>;
  const path = zi.path.map(String);
  const pathStr = path.join('.');
  const depth = path.length;
  const lastKey = path[depth - 1] ?? '';

  if (depth === 1 && zi.code === 'invalid_type') {
    return mkIssue(
      file,
      pathStr,
      `Missing or invalid ${pathStr} section`,
      SECTION_HELP[pathStr] ?? `Add ${pathStr} section`,
    );
  }

  if (zi.code === 'invalid_type' && ziAny['expected'] === 'object') {
    if (pathStr.startsWith('roles.assignments.') && depth === 3) {
      return mkIssue(
        file,
        pathStr,
        'Assignment must be an object',
        `Define model for role ${path[2]}`,
      );
    }
    return mkIssue(
      file,
      pathStr,
      `Required object "${lastKey}" is missing or invalid`,
      FIELD_HELP[pathStr] ?? `Add ${pathStr} as an object`,
    );
  }

  if (zi.code === 'too_small') {
    const origin = ziAny['origin'] as string | undefined;
    if (origin === 'number') {
      return mkIssue(
        file,
        pathStr,
        'Must be a positive number',
        FIELD_HELP[pathStr] ?? `Set ${pathStr} to a positive value`,
      );
    }
    return mkIssue(
      file,
      pathStr,
      `Required string field "${lastKey}" is missing or empty`,
      FIELD_HELP[pathStr] ?? `Provide a value for ${pathStr}`,
    );
  }

  if (zi.code === 'invalid_value' && Array.isArray(ziAny['values'])) {
    const values = ziAny['values'] as string[];
    return mkIssue(
      file,
      pathStr,
      `Must be one of: ${values.join(', ')}`,
      FIELD_HELP[pathStr] ?? `Set ${pathStr} to one of: ${values.join(', ')}`,
    );
  }

  if (zi.code === 'invalid_type' && ziAny['expected'] === 'string') {
    return mkIssue(
      file,
      pathStr,
      `Required string field "${lastKey}" is missing or empty`,
      FIELD_HELP[pathStr] ?? `Provide a value for ${pathStr}`,
    );
  }

  return mkIssue(file, pathStr, zi.message, `Check ${pathStr}`);
}

function validateExcludeRoles(
  config: Record<string, unknown>,
  file: string,
  errors: ValidationIssue[],
): void {
  const workflow = config['workflow'];
  if (!isObject(workflow)) {
    return;
  }
  const variants = workflow['variants'];
  if (!isObject(variants)) {
    return;
  }

  const knownRoles = new Set<string>();
  const roles = config['roles'];
  if (isObject(roles)) {
    const assignments = roles['assignments'];
    if (isObject(assignments)) {
      for (const role of Object.keys(assignments)) {
        knownRoles.add(role);
      }
    }
  }

  for (const [variantName, variantDef] of Object.entries(variants)) {
    if (!isObject(variantDef)) {
      continue;
    }
    const states = variantDef['states'];
    if (!isObject(states)) {
      continue;
    }
    for (const [stateId, stateDef] of Object.entries(states)) {
      if (!isObject(stateDef)) {
        continue;
      }
      const excludeRoles = stateDef['exclude_roles'];
      if (!Array.isArray(excludeRoles)) {
        continue;
      }
      const path = `workflow.variants.${variantName}.states.${stateId}.exclude_roles`;

      for (const role of excludeRoles) {
        if (typeof role === 'string' && !knownRoles.has(role)) {
          errors.push(
            mkIssue(
              file,
              path,
              `Unknown role "${role}" in exclude_roles`,
              `Use one of: ${[...knownRoles].sort().join(', ')}`,
            ),
          );
        }
      }
    }
  }
}

function validateRunnerAssignments(
  config: Record<string, unknown>,
  file: string,
  registry: readonly RunnerDefinition[],
  errors: ValidationIssue[],
): void {
  const roles = config['roles'];
  if (!isObject(roles)) {
    return;
  }
  const assignments = roles['assignments'];
  if (!isObject(assignments)) {
    return;
  }

  const runnerIds = registry.map((r) => r.id);
  const modelsByRunner = new Map(registry.map((r) => [r.id, r.models]));

  for (const [roleName, roleDef] of Object.entries(assignments)) {
    if (!isObject(roleDef)) {
      continue;
    }
    const runner = roleDef['runner'] as string | undefined;
    const model = roleDef['model'] as string | undefined;

    if (runner && !modelsByRunner.has(runner)) {
      errors.push(
        mkIssue(
          file,
          `roles.assignments.${roleName}.runner`,
          `Unknown runner "${runner}"`,
          `Use one of: ${runnerIds.join(', ')}`,
        ),
      );
      continue;
    }

    if (model && runner) {
      const allowed = modelsByRunner.get(runner) ?? [];
      if (!allowed.includes(model)) {
        errors.push(
          mkIssue(
            file,
            `roles.assignments.${roleName}.model`,
            `Model "${model}" is not available for runner "${runner}"`,
            `Use one of: ${allowed.join(', ')}`,
          ),
        );
      }
    }
  }
}

function collectWarnings(
  config: Record<string, unknown>,
  file: string,
  warnings: ValidationIssue[],
): void {
  const governance = config['governance'];
  if (isObject(governance)) {
    const limits = governance['iterationLimits'];
    if (isObject(limits)) {
      const defaults = limits['defaults'];
      if (isObject(defaults)) {
        const max = defaults['maxReviewIterations'];
        if (typeof max === 'number' && max > 10) {
          warnings.push({
            severity: 'warning',
            file,
            path: 'governance.iterationLimits.defaults.maxReviewIterations',
            message: 'Value exceeds 10, which may cause excessive token usage',
            remediation: 'Consider reducing maxReviewIterations',
          });
        }
        const maxAcceptance = defaults['maxAcceptanceIterations'];
        if (typeof maxAcceptance === 'number' && maxAcceptance > 10) {
          warnings.push({
            severity: 'warning',
            file,
            path: 'governance.iterationLimits.defaults.maxAcceptanceIterations',
            message: 'Value exceeds 10, which may cause excessive token usage',
            remediation: 'Consider reducing maxAcceptanceIterations',
          });
        }
      }
    }

    const budget = governance['budget'];
    if (isObject(budget)) {
      const thresholds = budget['alertThresholds'];
      if (Array.isArray(thresholds)) {
        const unique = new Set(thresholds as number[]);
        if (unique.size < thresholds.length) {
          warnings.push({
            severity: 'warning',
            file,
            path: 'governance.budget.alertThresholds',
            message: 'Duplicate values in alertThresholds',
            remediation: 'Remove duplicate threshold entries',
          });
        }
      }
    }
  }
}

function mkIssue(
  file: string,
  path: string,
  message: string,
  remediation: string,
): ValidationIssue {
  return { severity: 'error', file, path, message, remediation };
}
