import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as shared from '@club/shared';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { renderToString } = require('react-dom/server');
const ts = require('typescript');

// Run the actual TS sources in a separate server process: the client test must
// not reuse a server-renderer's context or QueryClient state.
function source(relative, overrides = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = { exports: {} };
  const localRequire = createRequire(path);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  new Function('require', 'module', 'exports', outputText)(
    (name) => (Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name)),
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}
const { Providers, Protected, useAuth } = source('../../components/providers.tsx', {
  '@club/shared': shared,
  '@/lib/api/client': {},
  '@/lib/format': {},
  '@/lib/use-hydrated': source('../../lib/use-hydrated.ts'),
  'next/navigation': { useRouter: () => ({}), usePathname: () => '/curator' },
});
function AuthState() {
  const auth = useAuth();
  return React.createElement('p', { id: 'auth-state' }, auth.me ? 'READY' : 'LOADING');
}
const tree = React.createElement(
  Providers,
  { hasSession: true },
  React.createElement(AuthState),
  React.createElement(
    React.Suspense,
    { fallback: React.createElement('p', null, 'Loading component') },
    React.createElement(
      Protected,
      { area: process.argv[2] },
      React.createElement('h1', null, 'Allowed'),
    ),
  ),
);
process.stdout.write(renderToString(tree));
