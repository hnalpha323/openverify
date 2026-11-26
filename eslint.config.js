// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { phase5Config } from './packages/config/eslint/phase5-rules.js';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/next-env.d.ts',
    // e2e run output (service logs, the e2e flow build, Playwright reports).
    'e2e/.artifacts/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/flow/**', 'apps/dashboard/**', 'packages/ui/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // C53.8, C58.7: the Phase 5 folders' log-key and regular-expression rules.
  ...phase5Config(),
  prettier,
);
