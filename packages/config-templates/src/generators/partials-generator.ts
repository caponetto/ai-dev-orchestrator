import { PARTIALS_DIR } from '../paths';

import { listStaticFiles, readStaticFile } from './static-utils';

export const ALL_PARTIAL_IDS: string[] = listStaticFiles(PARTIALS_DIR, '.md');

export function generatePartialFile(partialId: string): string {
  return readStaticFile(PARTIALS_DIR, `${partialId}.md`);
}
