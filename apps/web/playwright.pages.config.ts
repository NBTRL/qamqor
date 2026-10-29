import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: 'managed-pages.spec.ts',
  workers: 1,
  outputDir: '../../.qa/pages',
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3400',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined },
  },
  webServer: [
    {
      command: 'node test/fixtures/pages-api.mjs',
      url: 'http://127.0.0.1:4400/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3400',
      url: 'http://localhost:3400/login',
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4400' },
      reuseExistingServer: false,
    },
  ],
});
