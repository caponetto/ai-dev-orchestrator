import type { PartialMap } from '@ai-orchestrator/schemas';

import { MissingPartialError, UndefinedVariableError } from '../domain/errors';

export interface RenderContext {
  readonly [key: string]: unknown;
}

export function renderTemplate(
  template: string,
  context: RenderContext,
  partials: PartialMap = {},
  role = 'unknown',
): string {
  let result = template;

  result = stripComments(result);
  result = resolvePartials(result, partials);
  result = resolveEachBlocks(result, context, partials, role);
  result = resolveConditionals(result, context);
  result = resolveVariables(result, context, role);

  return result;
}

function stripComments(template: string): string {
  return template.replace(/\{\{![\s\S]*?\}\}/gu, '');
}

function resolvePartials(template: string, partials: PartialMap): string {
  const maxDepth = 10;
  let result = template;

  for (let depth = 0; depth < maxDepth && /\{\{>\s*\w+\s*\}\}/u.test(result); depth++) {
    result = result.replace(/\{\{>\s*(\w+)\s*\}\}/gu, (_match, name: string) => {
      if (!Object.hasOwn(partials, name)) {
        throw new MissingPartialError(name);
      }
      return partials[name];
    });
  }

  return result;
}

function resolveEachBlocks(
  template: string,
  context: RenderContext,
  partials: PartialMap,
  role: string,
): string {
  const eachPattern = /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/gu;

  return template.replace(eachPattern, (_match, path: string, body: string) => {
    const collection = resolvePath(context, path);
    if (!Array.isArray(collection)) {
      return '';
    }

    return collection
      .map((item: unknown, index: number) => {
        const itemContext: RenderContext = {
          ...context,
          ...(typeof item === 'object' && item !== null
            ? (item as Record<string, unknown>)
            : { '.': item }),
          '@index': index,
          '@first': index === 0,
          '@last': index === collection.length - 1,
        };
        let rendered = resolveConditionals(body, itemContext);
        rendered = resolveVariables(rendered, itemContext, role);
        rendered = resolvePartials(rendered, partials);
        return rendered;
      })
      .join('');
  });
}

function resolveConditionals(template: string, context: RenderContext): string {
  let result = template;

  const ifPattern = /\{\{#if\s+([\w.@]+)\}\}([\s\S]*?)\{\{\/if\}\}/gu;
  result = result.replace(ifPattern, (_match, path: string, body: string) => {
    const value = resolvePath(context, path);
    return isTruthy(value) ? body : '';
  });

  const unlessPattern = /\{\{#unless\s+([\w.@]+)\}\}([\s\S]*?)\{\{\/unless\}\}/gu;
  result = result.replace(unlessPattern, (_match, path: string, body: string) => {
    const value = resolvePath(context, path);
    return isTruthy(value) ? '' : body;
  });

  return result;
}

function resolveVariables(template: string, context: RenderContext, role: string): string {
  let result = template;

  result = result.replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/gu, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined) {
      throw new UndefinedVariableError(path, role);
    }
    return stringifyValue(value);
  });

  result = result.replace(/\{\{\s*([\w.@]+)\s*\}\}/gu, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined) {
      throw new UndefinedVariableError(path, role);
    }
    return escapeHtml(stringifyValue(value));
  });

  return result;
}

function resolvePath(context: RenderContext, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === '' || value === 0) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
