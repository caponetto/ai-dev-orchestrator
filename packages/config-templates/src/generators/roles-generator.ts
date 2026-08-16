import { ROLES_DIR } from '../paths';
import { roleSchema } from '../schemas/static-schemas';

import { listStaticFiles, readAndValidateStaticYaml, stringifyYaml } from './static-utils';

const ROLES_HEADER = [
  '# Role definitions for the orchestrator.',
  '# Each role is an autonomous agent assigned to a specific workflow phase.',
  '#',
  '# Properties:',
  '#   id                      - Unique identifier used in workflow transitions and artifact ownership.',
  '#   name                    - Human-readable display name.',
  '#   description             - What this role does in the workflow.',
  '#   owned_artifacts         - Artifacts this role is allowed to produce.',
  '#   readable_artifacts      - Artifacts this role can read as input.',
  '#   forbidden_artifacts     - Artifacts this role must never access (isolation boundary).',
  "#   reviewed_by             - Roles that review this role's output.",
  '#   reviews                 - Roles whose output this role reviews.',
  '#   agreement_participation - Agreements this role participates in (type + action).',
  '#   required_capabilities   - Agent capabilities needed (reasoning, code_generation, etc.).',
  '#   model                   - LLM model identifier for this role.',
  '#   max_tokens              - Maximum output tokens override (null = model default).',
  '#   dispatch_type           - How to run (currently only "agent").',
  '#   runner                  - Which runner to use (claude-code, cursor, verifier, etc.).',
  '#   agent_config            - Optional runner-specific configuration (e.g. model override).',
  '',
].join('\n');

export function generateRolesYaml(): string {
  const files = listStaticFiles(ROLES_DIR, '.yaml', false);
  const roles = files.map((file) => readAndValidateStaticYaml(roleSchema, ROLES_DIR, file).data);
  return `${ROLES_HEADER}${stringifyYaml({ roles })}\n`;
}
