import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ConfigurationLoader,
  LoadContext,
  ValidationIssue,
  ValidationReport,
} from '@ai-dev-orchestrator/ports';
import type { MergedConfiguration } from '@ai-dev-orchestrator/schemas';
import { isObject, snakeToCamelDeep } from '@ai-dev-orchestrator/utils';

import type { EnvVarResolutionError } from '../../domain/configuration/errors';
import { ConfigurationLoadError } from '../../domain/configuration/errors';

import { resolveEnvVars } from './env-var-resolver';
import { validateConfiguration } from './schema-validator';
import { parseYamlFile } from './yaml-file-parser';

/** Required configuration files inside the global `~/.ai/` config directory. */
export const REQUIRED_CONFIG_FILES = ['config.yaml', 'roles.yaml', 'governance.yaml'] as const;

const ROLE_ASSIGNMENT_FIELDS = [
  'model',
  'dispatchType',
  'runner',
  'agentConfig',
  'maxTokens',
] as const;

/**
 * Loads configuration from `.ai/` files, validates, and freezes.
 *
 * @remarks
 * Pipeline: check required files → parse YAML → convert keys → resolve env vars
 * → assemble → validate → freeze.
 */
export class FileSystemConfigurationLoader implements ConfigurationLoader {
  /**
   * Load and validate all configuration.
   *
   * @param context - Paths to configuration sources
   * @returns The validated, frozen configuration
   * @throws ConfigurationLoadError if validation fails
   */
  load(context: LoadContext): MergedConfiguration {
    const report = this.validate(context);
    if (!report.valid || !report.effectiveConfig) {
      const message =
        report.errors.length === 1
          ? report.errors[0].message
          : `Configuration validation failed with ${String(report.errors.length)} error(s)`;
      throw new ConfigurationLoadError(
        message,
        report.errors.map((e) => `${e.path}: ${e.message}`),
      );
    }
    return deepFreeze(report.effectiveConfig);
  }

  /**
   * Validate configuration without loading into the runtime.
   *
   * @param context - Paths to configuration sources
   * @returns A report containing all errors and warnings
   */
  validate(context: LoadContext): ValidationReport {
    const missingFile = findMissingRequiredFile(context.aiConfigDir);
    if (missingFile) {
      const filePath = join(context.aiConfigDir, missingFile);
      return {
        valid: false,
        errors: [missingFileError(filePath, missingFile)],
        warnings: [],
      };
    }

    const parseResult = parseRequiredFiles(context.aiConfigDir);
    if (!parseResult.ok) {
      return {
        valid: false,
        errors: [parseResult.error],
        warnings: [],
      };
    }

    const envErrors: EnvVarResolutionError[] = [];
    const resolvedFiles: Record<string, Record<string, unknown>> = {};

    for (const [fileName, raw] of Object.entries(parseResult.value)) {
      const filePath = join(context.aiConfigDir, fileName);
      const camel = snakeToCamelDeep(raw) as Record<string, unknown>;
      const { resolved, errors } = resolveEnvVars(camel, filePath);
      resolvedFiles[fileName] = resolved;
      envErrors.push(...errors);
    }

    const assembled = assembleConfiguration(resolvedFiles);
    const envWarnings: ValidationIssue[] = envErrors.map((envErr) => ({
      severity: 'warning' as const,
      file: envErr.filePath,
      path: envErr.fieldPath,
      message: envErr.message,
      remediation: `Set the ${envErr.variableName} environment variable or remove the reference`,
    }));

    const result = validateConfiguration(assembled, '<merged>', context.runnerRegistry);
    return {
      ...result,
      warnings: [...result.warnings, ...envWarnings],
    };
  }
}

function findMissingRequiredFile(aiConfigDir: string): string | undefined {
  for (const file of REQUIRED_CONFIG_FILES) {
    if (!existsSync(join(aiConfigDir, file))) {
      return file;
    }
  }
  return undefined;
}

function missingFileError(filePath: string, fileName: string): ValidationIssue {
  return {
    severity: 'error',
    file: filePath,
    path: '',
    message: `Required configuration file missing: ${fileName}. Run 'init' to generate default configuration.`,
    remediation: "Run 'init' to generate default configuration.",
  };
}

function parseRequiredFiles(
  aiConfigDir: string,
):
  | { ok: true; value: Record<string, Record<string, unknown>> }
  | { ok: false; error: ValidationIssue } {
  const parsed: Record<string, Record<string, unknown>> = {};

  for (const file of REQUIRED_CONFIG_FILES) {
    const filePath = join(aiConfigDir, file);
    const result = parseYamlFile(filePath);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          severity: 'error',
          file: filePath,
          path: '',
          message: result.error.message,
          remediation: `Fix the YAML syntax in ${file}`,
        },
      };
    }
    parsed[file] = result.value;
  }

  return { ok: true, value: parsed };
}

function assembleConfiguration(
  files: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const configData = files['config.yaml'] ?? {};
  const rolesData = files['roles.yaml'] ?? {};
  const governanceData = files['governance.yaml'] ?? {};

  const rawWorkflow = configData['defaultWorkflow'];
  const defaultWorkflowName = typeof rawWorkflow === 'string' ? rawWorkflow : 'dev';

  const rawVersion = configData['workflowVersion'];
  const workflow: Record<string, unknown> = {
    name: defaultWorkflowName,
    version: typeof rawVersion === 'string' ? rawVersion : '1.0',
  };
  if (configData['globalTransitionLimit'] !== undefined) {
    workflow['globalTransitionLimit'] = configData['globalTransitionLimit'];
  }

  const runtime: Record<string, unknown> = {
    logLevel: configData['logLevel'],
  };
  if (configData['reportOutputPath'] !== undefined) {
    runtime['reportOutputPath'] = configData['reportOutputPath'];
  }

  const roles: Record<string, unknown> = {
    assignments: extractRoleAssignments(rolesData),
  };
  const permissionPolicy = governanceData['permissionPolicy'];
  if (permissionPolicy !== undefined) {
    roles['permissionPolicy'] = permissionPolicy;
  }

  const governance: Record<string, unknown> = {
    iterationLimits: {
      defaults: governanceData['iterationLimits'] ?? {},
    },
    qualityGates: governanceData['qualityGates'],
  };
  if (governanceData['budget'] !== undefined) {
    governance['budget'] = governanceData['budget'];
  }

  return { workflow, roles, governance, runtime };
}

function extractRoleAssignments(
  rolesData: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const roles = rolesData['roles'];
  if (!Array.isArray(roles)) {
    return {};
  }

  const assignments: Record<string, Record<string, unknown>> = {};
  for (const entry of roles) {
    if (!isObject(entry)) {
      continue;
    }
    const roleId = entry['id'];
    if (typeof roleId !== 'string' || roleId.length === 0) {
      continue;
    }

    const assignment: Record<string, unknown> = {};
    for (const field of ROLE_ASSIGNMENT_FIELDS) {
      if (entry[field] !== undefined) {
        assignment[field] = entry[field];
      }
    }
    assignments[roleId] = assignment;
  }

  return assignments;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return obj;
}
