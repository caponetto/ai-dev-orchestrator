import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  findUnlistedRoleModels,
  parseRoleModel,
  parseRunnerModels,
  renderRolesSummary,
  ROLES_DIR,
  RUNNERS_FILE,
  writeSummary,
} from './common.ts';

/** Fails the process when a role uses a runner/model pair missing from runners.yaml. */
export function checkRolesUseListedModels(
  rolesDir: string = ROLES_DIR,
  runnersFile: string = RUNNERS_FILE,
): void {
  const runners = parseRunnerModels(readFileSync(runnersFile, 'utf8'));
  const roles = readdirSync(rolesDir)
    .filter((file) => file.endsWith('.yaml'))
    .flatMap((file) => {
      const text = readFileSync(resolve(rolesDir, file), 'utf8');
      const parsed = parseRoleModel(file.replace(/\.yaml$/, ''), text);
      return parsed === undefined ? [] : [parsed];
    });
  if (roles.length === 0) {
    console.error('::error::No role definitions with a runner and model were found');
    process.exitCode = 1;
    return;
  }
  writeSummary(renderRolesSummary(roles, runners));
  const problems = findUnlistedRoleModels(roles, runners);
  for (const problem of problems) {
    console.error(`::error::${problem}`);
  }
  if (problems.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`All ${String(roles.length)} roles use models listed in runners.yaml.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  checkRolesUseListedModels();
}
