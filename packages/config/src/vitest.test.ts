import { describe, expect, it } from 'vitest';
import { COVERAGE_THRESHOLD, createVitestConfig } from './vitest.js';

type CoverageConfig = NonNullable<
  NonNullable<ReturnType<typeof createVitestConfig>['test']>['coverage']
>;

function coverageOf(config: ReturnType<typeof createVitestConfig>): CoverageConfig {
  const coverage = config.test?.coverage;
  if (coverage === undefined) {
    throw new Error('coverage config missing');
  }
  return coverage;
}

describe('createVitestConfig', () => {
  it('enforces an 80% coverage floor on lines, branches, functions and statements', () => {
    const coverage = coverageOf(createVitestConfig());

    expect(COVERAGE_THRESHOLD).toBe(80);
    expect(coverage).toMatchObject({
      enabled: true,
      provider: 'v8',
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    });
  });

  it('measures every source file under src, not only the files a test happens to import', () => {
    const coverage = coverageOf(createVitestConfig());

    expect(coverage).toMatchObject({ include: ['src/**/*.{ts,tsx}'] });
    expect(coverage).toHaveProperty(
      'exclude',
      expect.arrayContaining(['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts']),
    );
  });

  it('runs colocated tests in the node environment by default', () => {
    const config = createVitestConfig();

    expect(config.test?.include).toEqual(['src/**/*.test.{ts,tsx}']);
    expect(config.test?.environment).toBe('node');
  });

  it('gives each test and hook headroom for a workspace-wide parallel run', () => {
    // `pnpm test` runs every package at once through turbo. A test that takes 0.4 s alone
    // took more than 5 s (Vitest's default) under that load, so the default is raised. After
    // Workflow 6B a test that takes 1.6 s alone took 18.4 s there (load average 50 on 12 CPUs),
    // so a 20 s limit turned load into failures; a hang still fails within a minute.
    const config = createVitestConfig();

    expect(config.test?.testTimeout).toBe(60_000);
    expect(config.test?.hookTimeout).toBe(60_000);
    expect(createVitestConfig({ test: { hookTimeout: 60_000 } }).test?.hookTimeout).toBe(60_000);
  });

  it('gives each package half the CPUs, so a workspace-wide run does not starve hooks', () => {
    // With Vitest's default (every CPU but one per package), `pnpm test` reached a load of 59
    // on 12 CPUs and PGlite `beforeAll` hooks in db and api passed their 60 s timeout.
    expect(createVitestConfig().test?.maxWorkers).toBe('50%');
    expect(createVitestConfig({ test: { maxWorkers: 1 } }).test?.maxWorkers).toBe(1);
  });

  it("turns off Vitest's file-system module cache, which keeps import.meta.glob results stale (C48)", () => {
    // Vitest 5 persists transformed modules in node_modules/.vitest-cache and reuses a module's
    // transform while its own source is unchanged, so an `import.meta.glob` there missed a
    // fixture added later (Workflow 3B; reproduced again in Workflow 4A Stage 4 with
    // apps/flow's golden problems). Transforms are 3-5% of a run, so correctness wins.
    expect(createVitestConfig().test?.fsModuleCache).toBe(false);
  });

  it('resolves workspace packages to their TypeScript source so tests need no prior build', () => {
    const config = createVitestConfig();

    expect(config.resolve?.conditions).toContain('@openverify/source');
    expect(config.ssr?.resolve?.conditions).toContain('@openverify/source');
  });

  it('merges per-package overrides without dropping the coverage gate', () => {
    const config = createVitestConfig({
      test: { environment: 'jsdom', coverage: { exclude: ['src/main.tsx'] } },
    });
    const coverage = coverageOf(config);

    expect(config.test?.environment).toBe('jsdom');
    expect(coverage).toHaveProperty(
      'exclude',
      expect.arrayContaining(['src/main.tsx', 'src/**/*.d.ts']),
    );
    expect(coverage).toMatchObject({
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    });
  });
});
