import { cp, writeFile } from 'node:fs/promises';

// Vercel packages the compiled directory as the function root. Preserve its ESM scope.
await writeFile(new URL('../apps/api/dist/package.json', import.meta.url), '{"type":"module"}\n');

if (process.argv.includes('--standalone')) {
  await cp(
    new URL('../apps/api/dist/', import.meta.url),
    new URL('../apps/api/.vercel-api/', import.meta.url),
    { recursive: true },
  );
}
