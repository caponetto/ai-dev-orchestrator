import { readFileSync } from 'node:fs';

import type {
  AgreementParticipation,
  ArtifactType,
  ModelCapability,
  RoleContract,
  RoleId,
} from '@ai-orchestrator/schemas';
import {
  isObject,
  requireString,
  requireStringArray,
  snakeToCamelDeep,
} from '@ai-orchestrator/utils';
import { parse as parseYaml, YAMLParseError } from 'yaml';

const MISSING_ROLES_ARRAY_MESSAGE = 'roles.yaml must contain a "roles" array';

/** Parses unified roles.yaml content into typed role contracts. */
export function loadRolesFromYaml(yamlContent: string): RoleContract[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (error: unknown) {
    const message =
      error instanceof YAMLParseError ? error.message : `Invalid YAML: ${String(error)}`;
    throw new Error(message);
  }

  return mapRolesDocument(parsed);
}

/** Loads and parses a roles.yaml file from disk. */
export function loadRolesFromFile(filePath: string): RoleContract[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e: unknown) {
    throw new Error(`Cannot read roles file: ${String(e)}`);
  }

  if (content.trim() === '') {
    throw new Error(MISSING_ROLES_ARRAY_MESSAGE);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e: unknown) {
    const message = e instanceof YAMLParseError ? e.message : `Invalid YAML: ${String(e)}`;
    throw new Error(message);
  }

  if (parsed === null || parsed === undefined || Object.keys(parsed).length === 0) {
    throw new Error(MISSING_ROLES_ARRAY_MESSAGE);
  }

  return mapRolesDocument(parsed);
}

function mapRolesDocument(parsed: unknown): RoleContract[] {
  if (parsed === null || parsed === undefined) {
    throw new Error(MISSING_ROLES_ARRAY_MESSAGE);
  }

  const camel = snakeToCamelDeep(parsed) as Record<string, unknown>;
  if (!Array.isArray(camel['roles'])) {
    throw new Error(MISSING_ROLES_ARRAY_MESSAGE);
  }

  return camel['roles'].map((entry) => mapRoleEntry(entry));
}

function mapRoleEntry(raw: unknown): RoleContract {
  if (!isObject(raw)) {
    throw new Error('Each role entry must be an object');
  }

  const entry = snakeToCamelDeep(raw) as Record<string, unknown>;
  const contract: RoleContract = {
    id: requireString(entry, 'id') as RoleId,
    name: requireString(entry, 'name'),
    description: requireString(entry, 'description'),
    ownedArtifacts: requireStringArray(entry, 'ownedArtifacts') as ArtifactType[],
    readableArtifacts: requireStringArray(entry, 'readableArtifacts') as ArtifactType[],
    forbiddenArtifacts: requireStringArray(entry, 'forbiddenArtifacts') as ArtifactType[],
    reviewedBy: requireStringArray(entry, 'reviewedBy') as RoleId[],
    reviews: requireStringArray(entry, 'reviews') as RoleId[],
    agreementParticipation: mapAgreementParticipation(entry['agreementParticipation']),
    requiredCapabilities: requireStringArray(entry, 'requiredCapabilities') as ModelCapability[],
    dispatchType: 'agent',
  };

  const runner = entry['runner'];
  const agentConfig = entry['agentConfig'];
  const withRunner = typeof runner === 'string' ? { ...contract, runner } : contract;

  if (isObject(agentConfig)) {
    return { ...withRunner, agentConfig };
  }

  return withRunner;
}

function mapAgreementParticipation(value: unknown): AgreementParticipation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    if (!isObject(entry)) {
      throw new Error('Each agreement participation entry must be an object');
    }

    const agreement = snakeToCamelDeep(entry) as Record<string, unknown>;
    return {
      agreementType: requireString(agreement, 'agreementType'),
      action: requireString(agreement, 'action') as AgreementParticipation['action'],
    };
  });
}
