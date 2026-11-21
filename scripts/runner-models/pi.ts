import { checkRunner, run } from './common.ts';

/** `pi --list-models` prints a whitespace-aligned table; keep `provider/model` ids, one per line. */
function listModels(): string {
  const ids: string[] = [];
  for (const line of run('pi', ['--list-models']).split('\n')) {
    const columns = line
      .replace(/\u001b\[[0-9;]*m/g, '')
      .trim()
      .split(/\s+/);
    const [provider, model] = columns;
    if (
      provider === undefined ||
      model === undefined ||
      provider === 'provider' ||
      !/^[a-z0-9-]+$/i.test(provider) ||
      !/^[\w.*:/-]+$/.test(model)
    ) {
      continue;
    }
    ids.push(`${provider}/${model}`);
  }
  return ids.join('\n');
}

checkRunner({
  id: 'pi',
  name: 'Pi',
  version: () => run('pi', ['--version']).trim(),
  listModels,
});
