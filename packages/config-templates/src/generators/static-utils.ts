import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';
import type { z } from 'zod';

import { STATIC_DIR } from '../paths';
import { validateStatic } from '../schemas/static-schemas';

export function stringifyYaml(data: unknown): string {
  return stringify(data, { indent: 2, lineWidth: 120 });
}

export function listStaticFiles(
  subdir: string,
  extension: string,
  stripExtension = true,
): string[] {
  return readdirSync(join(STATIC_DIR, subdir))
    .filter((f) => f.endsWith(extension))
    .map((f) => (stripExtension ? f.replace(new RegExp(`\\${extension}$`), '') : f))
    .sort();
}

export function readStaticFile(subdir: string, filename: string): string {
  const filePath = subdir ? join(STATIC_DIR, subdir, filename) : join(STATIC_DIR, filename);
  return readFileSync(filePath, 'utf8');
}

export function readAndValidateStaticYaml<T>(
  schema: z.ZodType<T>,
  subdir: string,
  filename: string,
): { content: string; data: T } {
  const label = subdir ? `${subdir}/${filename}` : filename;
  const content = readStaticFile(subdir, filename);
  const data = validateStatic(schema, parse(content), label);
  return { content, data };
}
