import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: !process.argv.includes('--watch'),
  splitting: false,
  sourcemap: true,
});
