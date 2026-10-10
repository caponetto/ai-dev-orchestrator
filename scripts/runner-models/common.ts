import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { IGNORED_MODELS } from './ignored-models.ts';

const repoRoot = resolve(import.meta.dirname, '../..');
export const ROLES_DIR = resolve(repoRoot, 'packages/config-templates/src/static/roles');
export const RUNNERS_FILE = resolve(repoRoot, 'packages/config-templates/src/static/runners.yaml');

/** Extracts `id -> models` from the flat structure of runners.yaml without needing a YAML parser. */
export function parseRunnerModels(yamlText: string): Map<string, string[]> {
  const runners = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of yamlText.split('\n')) {
    const id = /^\s*-\s+id:\s*(\S+)\s*$/.exec(line);
    if (id?.[1] !== undefined) {
      current = [];
      runners.set(id[1], current);
      continue;
    }
    const model = /^\s{6}-\s+(\S+)\s*$/.exec(line);
    if (model?.[1] !== undefined && current !== undefined) {
      current.push(model[1]);
    }
  }
  return runners;
}

/** Whole-token match so `x-5` is not satisfied by `x-5-thinking-high`. */
export function findMissingModels(models: string[], availableText: string): string[] {
  const plain = availableText.replace(/\u001b\[[0-9;]*m/g, '');
  return models.filter((model) => {
    const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(?<![\\w./-])${escaped}(?![\\w./-])`).test(plain);
  });
}

/** Returns the available model ids (one per line of `availableText`) that are neither listed nor ignored. */
export function findNewModels(
  models: string[],
  availableText: string,
  ignored: RegExp[] = [],
): string[] {
  const listed = new Set(models);
  const ids = availableText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return [...new Set(ids)].filter(
    (id) =>
      !listed.has(id) && !ignored.some((pattern) => new RegExp(`^(?:${pattern.source})$`).test(id)),
  );
}

/** Appends to the GitHub job summary when running in Actions; otherwise prints to stdout. */
export function writeSummary(markdown: string): void {
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile === undefined || summaryFile === '') {
    console.log(markdown);
    return;
  }
  appendFileSync(summaryFile, `${markdown}\n`);
}

export interface RoleModel {
  role: string;
  runner: string;
  model: string;
}

/** Reads the top-level `runner` and `model` keys of a role definition. */
export function parseRoleModel(role: string, yamlText: string): RoleModel | undefined {
  const runner = /^runner:\s*(\S+)\s*$/m.exec(yamlText)?.[1];
  const model = /^model:\s*(\S+)\s*$/m.exec(yamlText)?.[1];
  return runner === undefined || model === undefined ? undefined : { role, runner, model };
}

/** Returns a message for every role whose runner/model pair is not listed in runners.yaml. */
export function findUnlistedRoleModels(
  roles: RoleModel[],
  runners: Map<string, string[]>,
): string[] {
  return roles.flatMap(({ role, runner, model }) => {
    const models = runners.get(runner);
    if (models === undefined) {
      return [`Role "${role}" uses unknown runner "${runner}"`];
    }
    return models.includes(model)
      ? []
      : [`Role "${role}" uses model "${model}" which is not listed for runner "${runner}"`];
  });
}

/** Renders the roles job summary as a table of each role's runner and model with a listed/unlisted status. */
export function renderRolesSummary(roles: RoleModel[], runners: Map<string, string[]>): string {
  const rows = [...roles]
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((entry) => {
      const listed = findUnlistedRoleModels([entry], runners).length === 0;
      return `| \`${entry.role}\` | ${entry.runner} | \`${entry.model}\` | ${listed ? '✅ listed' : '❌ not listed'} |`;
    });
  return [
    '## 🎭 Role models',
    '',
    `${String(roles.length)} roles checked against \`runners.yaml\`.`,
    '',
    '| Role | Runner | Model | Status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

export interface RunnerReport {
  name: string;
  version: string;
  current: string[];
  removed: string[];
  added: string[];
}

/** Renders the per-runner job summary: version, current models, new models and removed models. */
export function renderRunnerSummary({
  name,
  version,
  current,
  removed,
  added,
}: RunnerReport): string {
  const removedSet = new Set(removed);
  const lines = [
    `## ${name}`,
    '',
    `**CLI version:** \`${version}\``,
    '',
    `### Current models (${String(current.length)})`,
    '',
    ...current.map((model) => `- ${removedSet.has(model) ? '❌' : '✅'} \`${model}\``),
    '',
  ];
  if (added.length > 0) {
    lines.push(
      '### 🎉 New models available!',
      '',
      'Fresh models showed up in the CLI that are not in `runners.yaml` yet:',
      '',
      ...added.map((model) => `- \`${model}\``),
      '',
    );
  }
  if (removed.length > 0) {
    lines.push(
      '### 🗑️ Removed models',
      '',
      'Listed in `runners.yaml` but no longer offered by the CLI:',
      '',
      ...removed.map((model) => `- \`${model}\``),
      '',
    );
  }
  return lines.join('\n');
}

export interface RunnerCheck {
  id: string;
  name: string;
  version: () => string;
  /** Returns one available model id per line. */
  listModels: () => string;
}

/**
 * Writes the runner report to the job summary and fails the process when any model listed for the
 * runner is no longer available. New models are reported but never fail the job.
 */
export function checkRunner({ id, name, version, listModels }: RunnerCheck): void {
  try {
    const current = parseRunnerModels(readFileSync(RUNNERS_FILE, 'utf8')).get(id);
    if (current === undefined || current.length === 0) {
      throw new Error(`No models found for runner "${id}" in runners.yaml`);
    }
    const available = listModels();
    const removed = findMissingModels(current, available);
    const added = findNewModels(current, available, IGNORED_MODELS[id]);
    writeSummary(renderRunnerSummary({ name, version: version(), current, removed, added }));
    for (const model of removed) {
      console.error(`::error::Model "${model}" is no longer available for runner "${id}"`);
    }
    if (removed.length > 0) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
