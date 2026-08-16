import type { WorkflowDefinition } from '@ai-orchestrator/schemas';
import { snakeToCamelDeep } from '@ai-orchestrator/utils';
import { WorkflowValidator } from '@ai-orchestrator/workflow';
import { parse } from 'yaml';

import { WORKFLOWS_DIR } from '../paths';
import { validateStatic, workflowYamlSchema } from '../schemas/static-schemas';

import { listStaticFiles, readStaticFile } from './static-utils';

export function generateWorkflowYaml(name: string): string {
  let content: string;
  try {
    content = readStaticFile(WORKFLOWS_DIR, `${name}.yaml`);
  } catch {
    const available = getAvailableWorkflowNames();
    throw new Error(`Unknown workflow: ${name}. Available: ${available.join(', ')}`);
  }
  validateStatic(workflowYamlSchema, parse(content), `${WORKFLOWS_DIR}/${name}.yaml`);
  return content;
}

export function getAvailableWorkflowNames(): string[] {
  return listStaticFiles(WORKFLOWS_DIR, '.yaml');
}

const validator = new WorkflowValidator();

function parseWorkflowYaml(content: string): WorkflowDefinition | null {
  const raw = snakeToCamelDeep(parse(content) as unknown) as Record<string, unknown>;
  if (!raw['name'] || !raw['version'] || !raw['states']) {
    return null;
  }
  const candidate = raw as unknown as WorkflowDefinition;
  const validation = validator.validate(candidate);
  return validation.valid ? candidate : null;
}

export function getBuiltInWorkflows(): WorkflowDefinition[] {
  const results: WorkflowDefinition[] = [];
  for (const name of getAvailableWorkflowNames()) {
    const content = generateWorkflowYaml(name);
    const def = parseWorkflowYaml(content);
    if (def) {
      results.push(def);
    }
  }
  return results;
}

export function getBuiltInWorkflowByName(name: string): WorkflowDefinition | null {
  let content: string;
  try {
    content = generateWorkflowYaml(name);
  } catch {
    return null;
  }
  return parseWorkflowYaml(content);
}
