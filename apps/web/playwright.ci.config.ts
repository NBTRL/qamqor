import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: ['ui.spec.ts', 'login-redirect.spec.ts', 'session-tabs.spec.ts'],
  outputDir: '../../.qa/ci-browser',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined },
  },
  webServer: [
    {
      command: 'node test/fixtures/calendar-api.mjs',
      url: 'http://127.0.0.1:4200/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000',
      url: 'http://localhost:3000/login',
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4200' },
      reuseExistingServer: false,
    },
  ],
});
