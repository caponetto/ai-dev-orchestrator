import { checkRunner, run } from './common.ts';

function listModels(): string {
  const { models } = JSON.parse(run('codex', ['debug', 'models'])) as {
    models: { slug: string }[];
  };
  return models.map((model) => model.slug).join('\n');
}

checkRunner({
  id: 'codex',
  name: 'Codex',
  version: () => run('codex', ['--version']).trim(),
  listModels,
});
