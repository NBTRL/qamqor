import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/shared/src/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    exclude: ['**/*.e2e.test.ts'],
    testTimeout: 15000,
  },
});
