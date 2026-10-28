import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  outputDir: '../../.qa/playwright',
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
  },
  reporter: 'list',
});
