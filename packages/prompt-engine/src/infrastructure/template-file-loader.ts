import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACT_SCHEMA_MAP } from '@ai-dev-orchestrator/artifacts';
import type {
  ArtifactType,
  OutputContract,
  PartialMap,
  PromptTemplate,
  VariableDeclaration,
} from '@ai-dev-orchestrator/schemas';
import { isObject, snakeToCamelDeep } from '@ai-dev-orchestrator/utils';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

const MISSING_FRONTMATTER_MESSAGE = 'Template must have YAML frontmatter between --- delimiters';
const MISSING_REQUIRED_FIELDS_MESSAGE =
  'Template frontmatter must include role, version, and output_contract';

/** Parses markdown template content with YAML frontmatter into a PromptTemplate. */
export function loadTemplateFromMarkdown(content: string): PromptTemplate {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(MISSING_FRONTMATTER_MESSAGE);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterMatch[1]);
  } catch (error: unknown) {
    const message =
      error instanceof YAMLParseError ? error.message : `Invalid YAML: ${String(error)}`;
    throw new Error(message);
  }

  const frontmatter = snakeToCamelDeep(parsed) as Record<string, unknown>;
  const role = frontmatter['role'];
  const version = frontmatter['version'];
  const outputContract = frontmatter['outputContract'];

  if (typeof role !== 'string' || typeof version !== 'string' || !isObject(outputContract)) {
    throw new Error(MISSING_REQUIRED_FIELDS_MESSAGE);
  }

  const body = frontmatterMatch[2].trim();

  return {
    frontmatter: {
      role,
      version,
      description: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '',
      variables: mapVariables(frontmatter['variables']),
      partials: mapPartials(frontmatter['partials']),
      outputContract: mapOutputContract(role, outputContract),
    },
    body,
    source: `file:${role}.md`,
  };
}

/** Loads all markdown prompt templates from a directory. */
export function loadTemplatesFromDirectory(dirPath: string): PromptTemplate[] {
  const files = readdirSync(dirPath).filter((file) => file.endsWith('.md'));
  return files.map((file) => {
    const content = readFileSync(join(dirPath, file), 'utf-8');
    return loadTemplateFromMarkdown(content);
  });
}

/** Loads all markdown partial files from a directory. Returns a name->content map. */
export function loadPartialsFromDirectory(dirPath: string): PartialMap {
  const files = readdirSync(dirPath).filter((file) => file.endsWith('.md'));
  const partials: Record<string, string> = {};
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    partials[name] = readFileSync(join(dirPath, file), 'utf-8').trimEnd();
  }
  return partials;
}

function mapPartials(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function mapVariables(value: unknown): VariableDeclaration[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    if (!isObject(entry)) {
      throw new Error('Each template variable must be an object');
    }

    const variable = entry;
    const name = variable['name'];
    const type = variable['type'];
    const required = variable['required'];

    if (typeof name !== 'string' || typeof type !== 'string' || typeof required !== 'boolean') {
      throw new Error('Template variable must include name, type, and required fields');
    }

    const declaration: VariableDeclaration = {
      name,
      type: type as VariableDeclaration['type'],
      required,
    };

    if (typeof variable['artifactType'] === 'string') {
      return { ...declaration, artifactType: variable['artifactType'] as ArtifactType };
    }

    return declaration;
  });
}

function mapOutputContract(role: string, raw: Record<string, unknown>): OutputContract {
  const artifactType = raw['artifactType'];
  const format = raw['format'];
  const required = raw['required'];
  const repairEnabled = raw['repairEnabled'];
  const maxRepairAttempts = raw['maxRepairAttempts'];

  if (
    typeof artifactType !== 'string' ||
    typeof format !== 'string' ||
    typeof required !== 'boolean' ||
    typeof repairEnabled !== 'boolean' ||
    typeof maxRepairAttempts !== 'number'
  ) {
    throw new Error('Template output_contract is missing required fields');
  }

  return {
    role,
    artifactType: artifactType as ArtifactType,
    schema: zodSchemaToJsonSchema(artifactType as ArtifactType),
    format: format as OutputContract['format'],
    required,
    repairEnabled,
    maxRepairAttempts,
  };
}

function zodSchemaToJsonSchema(type: ArtifactType): Record<string, unknown> {
  if (!Object.hasOwn(ARTIFACT_SCHEMA_MAP, type)) {
    return {};
  }
  return z.toJSONSchema(ARTIFACT_SCHEMA_MAP[type], { target: 'draft-07', unrepresentable: 'any' });
}
