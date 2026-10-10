import { checkRunner, run } from './common.ts';

/**
 * A fresh machine has no model cache, so plain `opencode models` serves a stale list bundled with the
 * CLI. `--refresh` fetches the current one; its status message is dropped by keeping `provider/model` ids.
 */
function listModels(): string {
  return run('opencode', ['models', '--refresh'])
    .split('\n')
    .filter((line) => /^\S+\/\S+$/.test(line.trim()))
    .join('\n');
}

checkRunner({
  id: 'opencode',
  name: 'OpenCode CLI',
  version: () => run('opencode', ['--version']).trim(),
  listModels,
});
