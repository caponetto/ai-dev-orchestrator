import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.TREE_ROOT ?? process.argv[2];
if (!root) throw new Error('TREE_ROOT required');
const leaf = process.argv.includes('leaf');
const exitParent = process.env.TREE_PARENT_EXIT === '1';
process.on('SIGTERM', () => {});
writeFileSync(join(root, leaf ? 'leaf.pid' : 'parent.pid'), String(process.pid));
if (!leaf) {
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--experimental-detect-module',
      import.meta.filename,
      root,
      'leaf',
    ],
    {
      stdio: process.env.TREE_CLOSED_PIPES === '1' ? 'ignore' : 'inherit',
      env: process.env,
    },
  );
  child.on('spawn', () => {
    if (exitParent) {
      const ready = setInterval(() => {
        if (existsSync(join(root, 'leaf.beat'))) {
          clearInterval(ready);
          process.exit(0);
        }
      }, 10);
    }
  });
}
setInterval(() => {
  appendFileSync(join(root, leaf ? 'leaf.beat' : 'parent.beat'), 'beat\n');
}, 25);

if (!leaf && process.argv.includes('protocol')) {
  const emit = (type, payload) =>
    process.stdout.write(
      JSON.stringify({
        protocol: 'ado/agent/v1',
        messageId: type,
        timestamp: new Date().toISOString(),
        type,
        payload,
      }) + '\n',
    );
  emit('handshake', { capabilities: ['permission_request'] });
  if (process.argv.includes('done') || process.argv.includes('error')) {
    process.stdin.once('data', () => {
      const ready = setInterval(() => {
        if (existsSync(join(root, 'leaf.beat'))) {
          clearInterval(ready);
          if (process.argv.includes('error'))
            emit('error', { code: 'fixture', message: 'failure', recoverable: false });
          else {
            emit('artifact', {
              artifactType: 'plan',
              content: '{"summary":"done"}',
              isFinal: true,
            });
            emit('done', { status: 'success', summary: 'done' });
          }
        }
      }, 10);
    });
  }
}
