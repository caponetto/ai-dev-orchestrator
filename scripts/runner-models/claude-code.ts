import { readFileSync, realpathSync } from 'node:fs';

import { checkRunner, run } from './common.ts';

/**
 * Claude Code has no keyless model listing, so scan the installed binary for the model ids it embeds.
 * Dated snapshot suffixes are stripped so an undated alias is satisfied by its snapshot.
 */
function listModels(): string {
  const binary = realpathSync(run('which', ['claude']).trim());
  const text = readFileSync(binary).toString('latin1');
  const ids = text.match(/claude-(?:opus|sonnet|haiku)-[0-9][a-z0-9.-]*/g) ?? [];
  const normalized = ids.map((id) => id.replace(/-\d{8}(-v\d+)?$/, ''));
  // Drop internal variants so only user-facing ids are reported as new.
  return [...new Set(normalized.filter((id) => !/-v\d+$|-fast$|\./.test(id)))].join('\n');
}

checkRunner({
  id: 'claude-code',
  name: 'Claude Code',
  version: () => run('claude', ['--version']).trim(),
  listModels,
});
