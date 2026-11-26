// @ts-check
/**
 * Owner decision 8 after Workflow 6B: the package's own `typecheck` and `test` cover the benchmark
 * helpers. A module that imports the API's or the database package's sources (the CLIs and their
 * Postgres harness) stays under `benchmark:typecheck` alone: `@openverify/api` and `@openverify/db`
 * build on this package, so checking their sources from here would type-check a reverse
 * dependency, and turbo would cache this package's result without tracking their files.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENCHMARK_HELPERS } from './benchmark-vitest.config.mjs';

const PACKAGE = join(import.meta.dirname, '..');

/** Every benchmark module (not a test) and whether it reaches into apps/api or packages/db. */
async function benchmarkModules() {
  const names = (await readdir(join(PACKAGE, 'scripts'))).filter(
    (name) => /^benchmark-.+\.mjs$/u.test(name) && !name.endsWith('.test.mjs'),
  );
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(PACKAGE, 'scripts', name), 'utf8');
      return {
        path: `scripts/${name}`,
        reachesApi: /from '\.\.\/\.\.\/\.\.\/apps\/|from '\.\.\/\.\.\/db\//u.test(text),
      };
    }),
  );
}

/** @param {string} path */
const json = async (path) =>
  /** @type {Record<string, any>} */ (JSON.parse(await readFile(join(PACKAGE, path), 'utf8')));

describe('the package gates cover the benchmark helpers (owner decision 8)', () => {
  it('type-checks every helper with the package, and the API-bound modules only on their own', async () => {
    const tsconfig = await json('tsconfig.json');
    const own = await json('scripts/benchmark-tsconfig.json');
    /** @type {string[]} */
    const include = tsconfig.include;

    expect(tsconfig.compilerOptions).toMatchObject({ allowJs: true, checkJs: true });
    expect(include).toEqual(expect.arrayContaining(['src', 'scripts/benchmark-*.test.mjs']));
    expect(own.include).toEqual(['benchmark-*.mjs']);
    for (const module of await benchmarkModules()) {
      expect(include.includes(module.path), module.path).toBe(!module.reachesApi);
    }
  });

  it('gives both CLIs that parse a 2,000,000-name table the heap it needs (calibration-6c follow-up)', async () => {
    /** @type {Record<string, string>} */
    const scripts = (await json('package.json')).scripts;

    for (const name of ['benchmark:quality', 'benchmark:performance']) {
      expect(scripts[name], name).toMatch(/^node --max-old-space-size=12288 /u);
    }
  });

  it('runs the helpers’ tests with the package and gates their coverage at 80%', async () => {
    const { default: config } = /** @type {{ default: Record<string, any> }} */ (
      await import(new URL('../vitest.config.ts', import.meta.url).href)
    );
    const tests = (await readdir(join(PACKAGE, 'scripts'))).filter((name) =>
      name.endsWith('.test.mjs'),
    );

    expect(config.test.include).toEqual(
      expect.arrayContaining(['src/**/*.test.{ts,tsx}', 'scripts/benchmark-*.test.mjs']),
    );
    expect(config.test.coverage.include).toEqual(
      expect.arrayContaining(['src/**/*.{ts,tsx}', ...BENCHMARK_HELPERS]),
    );
    for (const test of tests) {
      const module = `scripts/${test.replace(/\.test\.mjs$/u, '.mjs')}`;
      const hasModule = (await benchmarkModules()).some((item) => item.path === module);
      expect(!hasModule || BENCHMARK_HELPERS.includes(module), module).toBe(true);
    }
  });
});
