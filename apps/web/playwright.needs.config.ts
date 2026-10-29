import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: 'public-needs.spec.ts',
  workers: 1,
  outputDir: '../../.qa/needs',
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3200',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined },
  },
  webServer: [
    {
      command: 'node test/fixtures/needs-api.mjs',
      url: 'http://127.0.0.1:4100/api/v1/health',
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3200',
      url: 'http://localhost:3200/login',
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4100' },
      reuseExistingServer: false,
    },
  ],
});
