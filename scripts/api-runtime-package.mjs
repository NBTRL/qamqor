import { writeFile } from 'node:fs/promises';

// Vercel packages the compiled directory as the function root. Preserve its ESM scope.
await writeFile(new URL('../apps/api/dist/package.json', import.meta.url), '{"type":"module"}\n');
