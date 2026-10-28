import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import next from '@next/eslint-plugin-next';
import hooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/generated/**',
      '**/next-env.d.ts',
      '**/schema.d.ts',
      '.husky/_/**',
      '.qa/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { '@next/next': next },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      ...hooks.configs.recommended.rules,
    },
    settings: { next: { rootDir: fileURLToPath(new URL('./apps/web/', import.meta.url)) } },
  },
  prettier,
);
