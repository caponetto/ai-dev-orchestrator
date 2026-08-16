import { CONFIG_FILENAME } from '../paths';
import { configSchema } from '../schemas/static-schemas';

import { readAndValidateStaticYaml } from './static-utils';

export function generateConfigYaml(): string {
  return readAndValidateStaticYaml(configSchema, '', CONFIG_FILENAME).content;
}
