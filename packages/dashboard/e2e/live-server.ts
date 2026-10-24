import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

interface LiveServer {
  url: string;
  control: (operation: string, args?: Record<string, unknown>) => Promise<unknown>;
}
export const test = base.extend<{ live: LiveServer }>({
  live: async ({ context }, use) => {
    const errors: string[] = [];
    const observe = (page: Page) => {
      page.on('pageerror', (error) => errors.push(error.message));
    };
    context.pages().forEach(observe);
    context.on('page', observe);
    const root = mkdtempSync(join(tmpdir(), 'browser-live-'));
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
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (!child.stdout) {
      throw new Error('Missing fixture stdout');
    }
    const lines = createInterface({ input: child.stdout });
    let nextId = 0;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    child.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        call?.reject(new Error(message.error));
      } else {
        call?.resolve(message.result);
      }
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Fixture startup timed out: ${stderr}`));
        }, 15_000);
        child.once('error', reject);
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Fixture exited ${String(code)}: ${stderr}`));
        });
        lines.on('line', (line) => {
          if (line.startsWith('{')) {
            clearTimeout(timeout);
            resolve((JSON.parse(line) as { port: number }).port);
          }
        });
      });
      const url = `http://127.0.0.1:${String(port)}`;
      const connect = async (target: BrowserContext) => {
        await target.route(
          (requestUrl) =>
            requestUrl.pathname.startsWith('/api/') || requestUrl.pathname === '/events',
          (route) => {
            const requestUrl = new URL(route.request().url());
            return route.continue({ url: `${url}${requestUrl.pathname}${requestUrl.search}` });
          },
        );
      };
      await connect(context);
      await use({
        url,
        control: (operation, args = {}) =>
          new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            child.send({ id, operation, ...args });
          }),
      });
      expect(errors, 'Unhandled browser exceptions').toEqual([]);
    } finally {
      context.off('page', observe);
      lines.close();
      const exited = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
      for (const call of pending.values()) {
        call.reject(new Error(`Fixture stopped: ${stderr}`));
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
});
