import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: ['ui.spec.ts', 'login-redirect.spec.ts', 'session-tabs.spec.ts'],
  outputDir: '../../.qa/playwright',
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
    },
  },
  reporter: 'list',
});
