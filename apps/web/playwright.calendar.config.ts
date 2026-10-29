import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: 'calendar-pagination.spec.ts',
  workers: 1,
  outputDir: '../../.qa/calendar',
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3300',
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
      command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3300',
      url: 'http://localhost:3300/login',
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4200' },
      reuseExistingServer: false,
    },
  ],
});
