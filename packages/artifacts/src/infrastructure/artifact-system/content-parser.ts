import { parse as parseYamlContent } from 'yaml';
import { type ZodType, z } from 'zod';

export const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/**
 * Parse a JSON string and validate the result against a Zod schema.
 * Returns a discriminated result instead of throwing.
 */
export function safeJsonParse<T>(content: string, schema: ZodType<T>): SafeParseResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { success: false, error: message };
}

export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match?.[1]) {
    return null;
  }
  try {
    return parseYamlContent(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseJson(content: string): Record<string, unknown> | null {
  const result = safeJsonParse(content, z.record(z.string(), z.unknown()));
  return result.success ? result.data : null;
}

export function parseYaml(content: string): Record<string, unknown> | null {
  try {
    return parseYamlContent(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse artifact content trying frontmatter first, then JSON. */
export function parseArtifactContent(content: string): Record<string, unknown> | null {
  return parseFrontmatter(content) ?? parseJson(content);
}

/**
 * Parse artifact content and validate against a Zod schema, returning the
 * typed result or null if parsing/validation fails. Tries frontmatter first,
 * then JSON — same extraction logic as parseArtifactContent but with schema
 * validation on top.
 */
export function parseTypedArtifactContent<T>(content: string, schema: ZodType<T>): T | null {
  const raw = parseFrontmatter(content) ?? parseJson(content);
  if (!raw) {
    return null;
  }
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}
