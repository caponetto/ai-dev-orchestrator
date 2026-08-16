export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`Field "${field}" must be a string`);
  }
  return value;
}

export function requireNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number') {
    throw new Error(`Field "${field}" must be a number`);
  }
  return value;
}

export function requireObject(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!isObject(value)) {
    throw new Error(`Field "${field}" must be an object`);
  }
  return value;
}

export function requireStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Field "${field}" must be an array of strings`);
  }
  return value;
}
