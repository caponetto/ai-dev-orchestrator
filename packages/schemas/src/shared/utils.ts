/**
 * Minimal schema interface for consumers that don't import Zod directly.
 * Any Zod schema satisfies this interface. The type parameter `T` carries
 * the parsed output type so callers get type-safe results without importing Zod.
 */
export interface SchemaLike<T = unknown> {
  safeParse(data: unknown): { success: boolean; data?: T; error?: { issues: unknown[] } };
}

/**
 * Parse a JSON value with a Zod schema.
 *
 * Throws a `SchemaValidationError` when parsing fails instead of
 * silently returning unvalidated data.
 */
export function safeParseResponse<T>(schema: SchemaLike<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success && result.data !== undefined) {
    return result.data;
  }
  const issues = result.error?.issues ?? [];
  throw new SchemaValidationError(issues);
}

export class SchemaValidationError extends Error {
  readonly issues: unknown[];
  constructor(issues: unknown[]) {
    super(`Schema validation failed: ${JSON.stringify(issues)}`);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}
