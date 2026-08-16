import { RUNNERS_FILENAME } from '../paths';
import { runnersSchema } from '../schemas/static-schemas';

import { readAndValidateStaticYaml } from './static-utils';

export interface RunnerEntry {
  readonly id: string;
  readonly name: string;
  readonly models: readonly string[];
}

export function loadRunnerRegistry(): RunnerEntry[] {
  return readAndValidateStaticYaml(runnersSchema, '', RUNNERS_FILENAME).data.runners;
}

export function generateRunnersYaml(): string {
  return readAndValidateStaticYaml(runnersSchema, '', RUNNERS_FILENAME).content;
}
