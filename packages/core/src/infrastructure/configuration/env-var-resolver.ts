import { EnvVarResolutionError } from '../../domain/configuration/errors';

const ENV_VAR_PATTERN = /\$\{([^}]+)}/g;

/**
 * Resolves `${VAR}` references in configuration values.
 *
 * @param config - The parsed configuration object
 * @param filePath - File path for error reporting
 * @returns The resolved configuration and any resolution errors
 */
export function resolveEnvVars(
  config: Record<string, unknown>,
  filePath: string,
): { resolved: Record<string, unknown>; errors: EnvVarResolutionError[] } {
  const errors: EnvVarResolutionError[] = [];
  const resolved = resolveValue(config, filePath, '', errors) as Record<string, unknown>;
  return { resolved, errors };
}

function resolveValue(
  value: unknown,
  filePath: string,
  currentPath: string,
  errors: EnvVarResolutionError[],
): unknown {
  if (typeof value === 'string') {
    return resolveString(value, filePath, currentPath, errors);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      resolveValue(item, filePath, `${currentPath}[${String(index)}]`, errors),
    );
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const path = currentPath ? `${currentPath}.${key}` : key;
      result[key] = resolveValue(val, filePath, path, errors);
    }
    return result;
  }
  return value;
}

function resolveString(
  value: string,
  filePath: string,
  currentPath: string,
  errors: EnvVarResolutionError[],
): string {
  return value.replace(ENV_VAR_PATTERN, (match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      errors.push(new EnvVarResolutionError(varName, filePath, currentPath));
      return match;
    }
    return envValue;
  });
}
