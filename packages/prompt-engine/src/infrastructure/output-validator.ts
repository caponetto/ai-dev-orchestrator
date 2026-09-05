import { ARTIFACT_SCHEMA_MAP } from '@ai-dev-orchestrator/artifacts';
import type {
  OutputContract,
  OutputValidationResult,
  ValidationError,
} from '@ai-dev-orchestrator/schemas';
import { parse as parseYaml } from 'yaml';

export function validateOutput(output: string, contract: OutputContract): OutputValidationResult {
  if (contract.format === 'freeform') {
    return { valid: true, errors: [] };
  }

  if (contract.format === 'json') {
    return validateJson(output, contract);
  }

  if (contract.format === 'yaml') {
    return validateYaml(output, contract);
  }

  return validateMarkdownWithFrontmatter(output, contract);
}

function validateJson(output: string, contract: OutputContract): OutputValidationResult {
  const cleaned = stripCodeFences(output);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Output is not valid JSON',
          expected: 'valid JSON',
          actual: output.slice(0, 100),
        },
      ],
    };
  }

  return validateAgainstSchema(parsed, contract);
}

function stripCodeFences(output: string): string {
  const trimmed = output.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) {
    return trimmed;
  }

  const header = trimmed.slice(0, firstNewline).trim();
  if (!/^```(?:json|JSON)?$/i.test(header)) {
    return trimmed;
  }

  const lastFenceIndex = trimmed.lastIndexOf('```');
  if (lastFenceIndex <= firstNewline) {
    return trimmed;
  }

  const footer = trimmed.slice(lastFenceIndex + 3).trim();
  if (footer.length > 0) {
    return trimmed;
  }

  return trimmed.slice(firstNewline + 1, lastFenceIndex).trim();
}

function validateYaml(output: string, contract: OutputContract): OutputValidationResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(output);
  } catch {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Output is not valid YAML',
          expected: 'valid YAML',
          actual: output.slice(0, 100),
        },
      ],
    };
  }

  return validateAgainstSchema(parsed, contract);
}

function validateMarkdownWithFrontmatter(
  output: string,
  contract: OutputContract,
): OutputValidationResult {
  const trimmed = output.trim();

  if (!trimmed.startsWith('---')) {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Output must start with YAML frontmatter delimiter (---)',
          expected: 'markdown with frontmatter',
          actual: trimmed.slice(0, 50),
        },
      ],
    };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Missing closing frontmatter delimiter (---)',
          expected: 'closing ---',
          actual: trimmed.slice(0, 100),
        },
      ],
    };
  }

  const frontmatterYaml = trimmed.substring(3, endIndex).trim();
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterYaml);
  } catch {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Frontmatter is not valid YAML',
          expected: 'valid YAML',
          actual: frontmatterYaml.slice(0, 100),
        },
      ],
    };
  }

  const parsedContent =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

  if (Object.keys(contract.schema).length === 0) {
    return { valid: true, errors: [], parsedContent };
  }

  return validateAgainstSchema(parsedContent, contract);
}

function getAtPath(obj: unknown, path: readonly PropertyKey[]): unknown {
  let current = obj;
  for (const segment of path) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function setAtPath(obj: unknown, path: readonly PropertyKey[], value: unknown): void {
  if (path.length === 0) {
    return;
  }
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (current == null || typeof current !== 'object') {
      return;
    }
    current = (current as Record<PropertyKey, unknown>)[path[i]];
  }
  if (current != null && typeof current === 'object') {
    (current as Record<PropertyKey, unknown>)[path[path.length - 1]] = value;
  }
}

function normalizeFromIssues(
  parsed: unknown,
  issues: ReadonlyArray<{ code: string; expected?: string; path: PropertyKey[] }>,
): { normalized: unknown; changed: boolean } {
  const normalized = structuredClone(parsed);
  let changed = false;

  for (const issue of issues) {
    if (issue.code !== 'invalid_type') {
      continue;
    }

    const value = getAtPath(normalized, issue.path);

    if (issue.expected === 'number' && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const num = Number(trimmed);
        if (!Number.isNaN(num)) {
          setAtPath(normalized, issue.path, num);
          changed = true;
        }
      }
    } else if (issue.expected === 'boolean' && typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true') {
        setAtPath(normalized, issue.path, true);
        changed = true;
      } else if (lower === 'false') {
        setAtPath(normalized, issue.path, false);
        changed = true;
      }
    }
  }

  return { normalized, changed };
}

function validateAgainstSchema(parsed: unknown, contract: OutputContract): OutputValidationResult {
  const parsedContent =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;

  if (Object.keys(contract.schema).length === 0) {
    return { valid: true, errors: [], parsedContent };
  }

  if (!Object.hasOwn(ARTIFACT_SCHEMA_MAP, contract.artifactType)) {
    return { valid: true, errors: [], parsedContent };
  }
  const zodSchema = ARTIFACT_SCHEMA_MAP[contract.artifactType];
  const result = zodSchema.safeParse(parsed);

  if (result.success) {
    return { valid: true, errors: [], parsedContent };
  }

  const { normalized, changed } = normalizeFromIssues(parsed, result.error.issues);
  if (changed) {
    const retry = zodSchema.safeParse(normalized);
    if (retry.success) {
      const normalizedContent =
        typeof normalized === 'object' && normalized !== null
          ? (normalized as Record<string, unknown>)
          : undefined;
      return { valid: true, errors: [], parsedContent: normalizedContent };
    }
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: '/' + issue.path.join('/'),
    message: issue.message,
    expected: JSON.stringify(issue.code),
    actual: JSON.stringify(parsed),
  }));

  return { valid: false, errors };
}
