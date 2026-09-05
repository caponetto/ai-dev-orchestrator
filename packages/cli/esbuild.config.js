import { existsSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const dev = process.env.NODE_ENV === 'development';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: dev ? 'linked' : false,
  minifySyntax: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "node:module";',
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: ['node:*', 'yaml', 'commander', 'write-file-atomic'],
});

const configTemplatesStatic = resolve('../config-templates/src/static');
if (existsSync(configTemplatesStatic)) {
  cpSync(configTemplatesStatic, resolve('dist/static'), { recursive: true });
}

const dashboardDist = resolve('../dashboard/dist');
if (existsSync(dashboardDist)) {
  cpSync(dashboardDist, resolve('dist/dashboard'), { recursive: true });
}
