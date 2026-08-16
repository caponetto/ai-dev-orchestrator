import { ARTIFACT_SCHEMA_MAP } from '@ai-orchestrator/artifacts';
import type {
  OutputContract,
  OutputValidationResult,
  ValidationError,
} from '@ai-orchestrator/schemas';
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
  const fenceMatch = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(trimmed);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
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

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: '/' + issue.path.join('/'),
    message: issue.message,
    expected: JSON.stringify(issue.code),
    actual: JSON.stringify(parsed),
  }));

  return { valid: false, errors };
}
