import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

test('browser approval, abort and retry reach production server and action handlers', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.stack ?? error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  const root = mkdtempSync(join(tmpdir(), 'browser-production-'));
  const cliRequire = createRequire(new URL('../../cli/package.json', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      '--import',
      cliRequire.resolve('tsx'),
      fileURLToPath(new URL('../../cli/test/fixtures/dashboard-process.mjs', import.meta.url)),
      'serve',
      root,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server startup timed out: ${stderr}`));
      }, 20_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited ${String(code)}: ${stderr}`));
      });
      lines.on('line', (line) => {
        if (!line.startsWith('{')) {
          return;
        }
        const info = JSON.parse(line) as { port: number };
        clearTimeout(timeout);
        resolve(info.port);
      });
    });
    const backend = `http://127.0.0.1:${String(port)}`;
    // Forward actual HTTP requests; this test supplies no canned API responses.
    await page.route(
      (url) => url.pathname.startsWith('/api/') || url.pathname === '/events',
      (route) => {
        const url = new URL(route.request().url());
        return route.continue({ url: `${backend}${url.pathname}${url.search}` });
      },
    );
    for (const [action, expected] of [
      ['approve', 'DONE'],
      ['abort', 'ABORTED'],
      ['retry', 'DONE'],
    ]) {
      const runId = `browser-${action}`;
      await page.goto(`/runs/${runId}`);
      if (action === 'approve') {
        await page.getByRole('button', { name: 'Approve', exact: true }).click();
      } else {
        await page
          .getByRole('button', { name: action === 'abort' ? 'Abort' : 'Retry', exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', {
            name: action === 'abort' ? 'Abort Run' : 'Retry Run',
            exact: true,
          })
          .click();
      }
      await expect
        .poll(
          async () => {
            const response = await request.get(`${backend}/api/runs/${runId}/state`);
            const state = (await response.json()) as { currentState: string };
            return state.currentState;
          },
          { timeout: 30_000, message: `${action} did not reach ${expected}: ${stderr}` },
        )
        .toBe(expected);
    }
  } catch (error) {
    const logs = ['approve', 'abort', 'retry']
      .map((action) => {
        const path = join(root, '.ai', 'runs', `browser-${action}`, 'cli-stderr.log');
        return existsSync(path) ? readFileSync(path, 'utf8') : '';
      })
      .join('\n');
    throw new Error(
      `${String(error)}\nBrowser errors: ${errors.join('\n')}\nServer: ${stderr}\nChildren: ${logs}`,
    );
  } finally {
    lines.close();
    const stopped = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => {
        resolve();
      });
      child.kill('SIGTERM');
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timeout);
      });
    });
    await stopped;
    rmSync(root, { recursive: true, force: true });
  }
});
