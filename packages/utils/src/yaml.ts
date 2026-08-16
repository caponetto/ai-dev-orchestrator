import { parse as parseYamlRaw, YAMLParseError } from 'yaml';

import { snakeToCamelDeep } from './key-converters';
import { isObject } from './type-guards';

export function parseYamlSafe(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYamlRaw(content);
  } catch (error: unknown) {
    const message =
      error instanceof YAMLParseError ? error.message : `Invalid YAML: ${String(error)}`;
    throw new Error(message);
  }
  if (!isObject(parsed)) {
    throw new Error('YAML content must be an object');
  }
  return parsed;
}

export function parseYamlAndNormalize(content: string): Record<string, unknown> {
  return snakeToCamelDeep(parseYamlSafe(content)) as Record<string, unknown>;
}
