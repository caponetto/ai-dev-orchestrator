import { GOVERNANCE_FILENAME } from '../paths';
import { governanceSchema } from '../schemas/static-schemas';

import { readAndValidateStaticYaml } from './static-utils';

export function generateGovernanceYaml(): string {
  return readAndValidateStaticYaml(governanceSchema, '', GOVERNANCE_FILENAME).content;
}
