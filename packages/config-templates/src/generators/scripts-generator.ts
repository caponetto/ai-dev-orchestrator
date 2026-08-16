import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SCRIPTS_DIR, STATIC_DIR } from '../paths';

import { readStaticFile } from './static-utils';

export const ALL_SCRIPT_FILES: string[] = readdirSync(join(STATIC_DIR, SCRIPTS_DIR))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

export function generateScriptFile(scriptName: string): string {
  return readStaticFile(SCRIPTS_DIR, scriptName);
}
