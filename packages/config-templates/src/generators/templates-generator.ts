import { TEMPLATES_DIR } from '../paths';

import { listStaticFiles, readStaticFile } from './static-utils';

export const ALL_ROLE_IDS: string[] = listStaticFiles(TEMPLATES_DIR, '.md');

export function generateTemplateFile(roleId: string): string {
  return readStaticFile(TEMPLATES_DIR, `${roleId}.md`);
}
