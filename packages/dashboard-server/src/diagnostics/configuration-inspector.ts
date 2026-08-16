import type {
  ConfigurationInspection,
  ConfigurationIssue,
  DiagnosticSeverity,
} from '@ai-orchestrator/schemas';
export interface ConfigurationRule {
  readonly path: string;
  readonly check: (value: unknown) => boolean;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly expectedValue?: unknown;
  readonly suggestion?: string;
}

export function inspectConfig(
  config: Readonly<Record<string, unknown>>,
  rules: readonly ConfigurationRule[],
  clock: () => string = () => new Date().toISOString(),
): ConfigurationInspection {
  const entries: ConfigurationIssue[] = [];

  for (const rule of rules) {
    const value = getNestedValue(config, rule.path);
    if (!rule.check(value)) {
      entries.push({
        severity: rule.severity,
        path: rule.path,
        message: rule.message,
        currentValue: value,
        expectedValue: rule.expectedValue,
        suggestion: rule.suggestion,
      });
    }
  }

  return {
    valid: entries.every((e) => e.severity !== 'error'),
    entries,
    checkedAt: clock(),
  };
}

function getNestedValue(obj: Readonly<Record<string, unknown>>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function createRequiredRule(path: string, suggestion?: string): ConfigurationRule {
  return {
    path,
    check: (value) => value !== undefined && value !== null && value !== '',
    severity: 'error',
    message: `Required configuration missing: ${path}`,
    suggestion: suggestion ?? `Set a value for ${path}`,
  };
}

export function createTypeRule(
  path: string,
  expectedType: string,
  suggestion?: string,
): ConfigurationRule {
  return {
    path,
    check: (value) => value === undefined || typeof value === expectedType,
    severity: 'warning',
    message: `Configuration ${path} should be of type ${expectedType}`,
    expectedValue: `<${expectedType}>`,
    suggestion,
  };
}
