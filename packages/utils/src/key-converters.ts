export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function snakeToCamelDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamelDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = snakeToCamelDeep(value);
    }
    return result;
  }
  return obj;
}

export function camelToSnake(str: string): string {
  if (str.includes('_') || str === str.toUpperCase()) {
    return str;
  }
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function camelToSnakeDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(camelToSnakeDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnake(key)] = camelToSnakeDeep(value);
    }
    return result;
  }
  return obj;
}
