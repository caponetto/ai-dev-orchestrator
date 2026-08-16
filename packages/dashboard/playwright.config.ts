import { defineConfig, devices } from '@playwright/test';

const VITE_PORT = 5_173;
const VITE_BASE_URL = `http://localhost:${String(VITE_PORT)}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? 'html' : 'list',

  use: {
    baseURL: VITE_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: VITE_BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
