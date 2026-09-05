import type { MergedConfiguration } from '@ai-dev-orchestrator/schemas';

import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { loadProjectConfig } from '../project-config';

export interface ConfigShowOptions {
  readonly json: boolean;
  readonly verbose: boolean;
}

function flattenObject(
  obj: unknown,
  prefix: string,
  result: Array<{ key: string; value: string }>,
): void {
  if (obj === null || obj === undefined) {
    return;
  }
  if (typeof obj !== 'object') {
    const primitive = obj as string | number | boolean;
    result.push({ key: prefix, value: String(primitive) });
    return;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      result.push({ key: prefix, value: '[]' });
    } else {
      for (let i = 0; i < obj.length; i++) {
        flattenObject(obj[i], `${prefix}[${String(i)}]`, result);
      }
    }
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    flattenObject(value, prefix ? `${prefix}.${key}` : key, result);
  }
}

function displaySection(
  formatter: OutputFormatter,
  sectionName: string,
  data: unknown,
  verbose: boolean,
): void {
  formatter.section(sectionName);
  const pairs: Array<{ key: string; value: string }> = [];
  flattenObject(data, '', pairs);

  const maxEntries = verbose ? pairs.length : Math.min(pairs.length, 20);
  const display: Record<string, unknown> = {};
  for (let i = 0; i < maxEntries; i++) {
    const pair = pairs[i];
    display[pair.key] = pair.value;
  }
  formatter.keyValue(display);

  if (!verbose && pairs.length > 20) {
    formatter.info(`  ... ${String(pairs.length - 20)} more entries (use --verbose to show all)`);
  }
}

export function configShowCommand(
  options: ConfigShowOptions,
  formatter: OutputFormatter,
): ExitCode {
  let config: MergedConfiguration;
  try {
    config = loadProjectConfig();
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(config) + '\n');
    return ExitCode.SUCCESS;
  }

  const sections: Array<{ name: string; data: unknown }> = [
    { name: 'workflow', data: config.workflow },
    { name: 'roles', data: config.roles },
    { name: 'governance', data: config.governance },
    { name: 'runtime', data: config.runtime },
  ];

  for (const section of sections) {
    displaySection(formatter, section.name, section.data, options.verbose);
  }

  return ExitCode.SUCCESS;
}
