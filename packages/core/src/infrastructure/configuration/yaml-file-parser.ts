import { readFileSync } from 'node:fs';

import type { Result } from '@ai-dev-orchestrator/schemas';
import { err, ok } from '@ai-dev-orchestrator/schemas';
import { parse as parseYaml, YAMLParseError } from 'yaml';

import { YamlParseError } from '../../domain/configuration/errors';

/**
 * Parses a YAML configuration file from disk.
 *
 * @param filePath - Absolute path to the YAML file
 * @returns The parsed object, or an empty object if the file does not exist
 */
export function parseYamlFile(filePath: string): Result<Record<string, unknown>, YamlParseError> {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') {
      return ok({});
    }
    return err(
      new YamlParseError(filePath, undefined, undefined, `Cannot read file: ${String(e)}`),
    );
  }

  if (content.trim() === '') {
    return ok({});
  }

  try {
    const parsed: unknown = parseYaml(content);
    if (parsed === null || parsed === undefined) {
      return ok({});
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return err(
        new YamlParseError(
          filePath,
          undefined,
          undefined,
          'Configuration file must be a YAML mapping (object), not a scalar or array',
        ),
      );
    }
    return ok(parsed as Record<string, unknown>);
  } catch (e: unknown) {
    if (e instanceof YAMLParseError) {
      const pos = e.linePos?.[0];
      return err(new YamlParseError(filePath, pos?.line, pos?.col, e.message));
    }
    return err(
      new YamlParseError(filePath, undefined, undefined, `Unexpected parse error: ${String(e)}`),
    );
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
