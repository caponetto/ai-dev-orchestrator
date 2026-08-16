import { generateConfigYaml } from './generators/config-generator';
import { generateGovernanceYaml } from './generators/governance-generator';
import { ALL_PARTIAL_IDS, generatePartialFile } from './generators/partials-generator';
import { generateRolesYaml } from './generators/roles-generator';
import { generateRunnersYaml } from './generators/runner-registry';
import { ALL_SCRIPT_FILES, generateScriptFile } from './generators/scripts-generator';
import { ALL_ROLE_IDS, generateTemplateFile } from './generators/templates-generator';
import {
  CONFIG_FILENAME,
  GOVERNANCE_FILENAME,
  PARTIALS_DIR,
  ROLES_FILENAME,
  RUNNERS_FILENAME,
  SCRIPTS_DIR,
  TEMPLATES_DIR,
} from './paths';

export function generateAll(): Map<string, string> {
  const files = new Map<string, string>();
  files.set(CONFIG_FILENAME, generateConfigYaml());
  files.set(ROLES_FILENAME, generateRolesYaml());
  files.set(GOVERNANCE_FILENAME, generateGovernanceYaml());
  files.set(RUNNERS_FILENAME, generateRunnersYaml());
  for (const roleId of ALL_ROLE_IDS) {
    files.set(`${TEMPLATES_DIR}/${roleId}.md`, generateTemplateFile(roleId));
  }
  for (const partialId of ALL_PARTIAL_IDS) {
    files.set(`${TEMPLATES_DIR}/${PARTIALS_DIR}/${partialId}.md`, generatePartialFile(partialId));
  }
  for (const scriptFile of ALL_SCRIPT_FILES) {
    files.set(`${SCRIPTS_DIR}/${scriptFile}`, generateScriptFile(scriptFile));
  }
  return files;
}

export function generateGlobalFiles(): Map<string, string> {
  return new Map<string, string>();
}
