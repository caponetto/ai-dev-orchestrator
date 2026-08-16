import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');

export const CONFIG_FILENAME = 'config.yaml';
export const GOVERNANCE_FILENAME = 'governance.yaml';
export const ROLES_FILENAME = 'roles.yaml';
export const RUNNERS_FILENAME = 'runners.yaml';

export const ROLES_DIR = 'roles';
export const WORKFLOWS_DIR = 'workflows';
export const SCRIPTS_DIR = 'scripts';
export const TEMPLATES_DIR = 'templates';
export const PARTIALS_DIR = 'partials';
