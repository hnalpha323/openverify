/**
 * Workflow 9A Stage 1b, checkpoint (F): the tooling `foundation-9a` adds for the Stage 3 owners
 * (C161.3, C159.1):
 *
 * - `@openverify/config/eslint-logical-properties`, the export of `flow-i18n`'s rule file, so the
 *   ESLint config that lints `apps/flow` and `packages/ui` can spread it;
 * - the `packages/sdk-js` skeleton (`@openverify/js`): its manifest with every dev dependency and no
 *   runtime dependency, the source condition, the lockfile importer, its tsconfigs, the shared
 *   Vitest config and the Vite library build (ESM and IIFE), so `flow-server-embed` owns only
 *   `packages/sdk-js/src/` and its tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');
const manifestOf = (file: string): Manifest => JSON.parse(read(file)) as Manifest;

interface Manifest {
  name: string;
  private?: boolean;
  exports: Record<string, string | Record<string, string>>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('the logical-properties rule export (C161.3)', () => {
  it('points at the rule file and its types', () => {
    const { exports } = manifestOf('packages/config/package.json');

    expect(exports['./eslint-logical-properties']).toEqual({
      types: './eslint/logical-properties.d.ts',
      default: './eslint/logical-properties.js',
    });
  });

  it('resolves by name to the rule and its config', async () => {
    // By a variable, so the type check does not need the export before it exists.
    const specifier = '@openverify/config/eslint-logical-properties';
    const rule = (await import(specifier)) as {
      logicalPropertiesConfig?: unknown;
      LOGICAL_PROPERTIES_FILES?: unknown;
    };

    expect(typeof rule.logicalPropertiesConfig).toBe('function');
    expect(rule.LOGICAL_PROPERTIES_FILES).toEqual([
      'apps/flow/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
    ]);
  });
});

describe('the embed client skeleton (C159.1)', () => {
  const manifestPath = 'packages/sdk-js/package.json';

  it('is @openverify/js, with no runtime dependency', () => {
    expect(existsSync(path.join(repoRoot, manifestPath))).toBe(true);
    const manifest = manifestOf(manifestPath);

    expect(manifest.name).toBe('@openverify/js');
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.exports['.']).toEqual({
      '@openverify/source': './src/index.ts',
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
  });

  it('carries every dev dependency its owner needs, from the catalog or the workspace', () => {
    const { devDependencies, scripts } = manifestOf(manifestPath);

    expect(devDependencies).toEqual({
      '@openverify/config': 'workspace:*',
      '@openverify/contracts': 'workspace:*',
      '@types/node': 'catalog:',
      '@vitest/coverage-v8': 'catalog:',
      jsdom: 'catalog:',
      typescript: 'catalog:',
      vite: 'catalog:',
      vitest: 'catalog:',
    });
    expect(scripts).toMatchObject({
      build: 'vite build && tsc -p tsconfig.build.json',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'vitest run --coverage',
    });
  });

  it('is an importer of the lockfile', () => {
    expect(read('pnpm-lock.yaml')).toMatch(/^ {2}packages\/sdk-js:$/m);
  });

  it('has its tsconfigs, the shared Vitest config and a library build in ESM and IIFE', () => {
    for (const file of ['tsconfig.json', 'tsconfig.build.json']) {
      expect(existsSync(path.join(repoRoot, 'packages/sdk-js', file)), file).toBe(true);
    }
    expect(read('packages/sdk-js/vitest.config.ts')).toContain('createVitestConfig(');
    const vite = read('packages/sdk-js/vite.config.ts');
    expect(vite).toContain("formats: ['es', 'iife']");
    expect(vite).toContain("name: 'OpenVerify'");
  });
});
