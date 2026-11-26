import { mergeConfig, type ViteUserConfig } from 'vitest/config';

/** Minimum coverage (percent) every OpenVerify package must reach on each metric. */
export const COVERAGE_THRESHOLD = 80;

/**
 * Export condition that maps a workspace package to its TypeScript source
 * (see each package's `exports`). TypeScript enables it via `customConditions`
 * in tsconfig.base.json; tests enable it here so no prior build is required.
 */
export const SOURCE_CONDITION = '@openverify/source';

// Vite's defaults (DEFAULT_CLIENT_CONDITIONS / DEFAULT_SERVER_CONDITIONS). Setting
// `conditions` replaces them, so they are restated after the source condition.
const CLIENT_CONDITIONS = [SOURCE_CONDITION, 'module', 'browser', 'development|production'];
const SERVER_CONDITIONS = [SOURCE_CONDITION, 'module', 'node', 'development|production'];

/**
 * Per-test and per-hook timeout (ms), a guard against a hang. `pnpm test` runs every package at
 * once through turbo, and CPU-bound tests (jsdom renders, OpenAPI generation, Argon2id) take many
 * times longer there than alone: after Workflow 6B, a test that takes 1.6 s alone took 18.4 s at
 * a load average of 50 on 12 CPUs, so 20 s turned load into failures. A hang still fails within a
 * minute.
 */
export const TEST_TIMEOUT_MS = 60_000;

/**
 * Vitest workers per package. Turbo runs every package's tests at once, and Vitest's default
 * (every CPU but one) put 59 runnable processes on 12 CPUs: PGlite `beforeAll` hooks in db and
 * api then passed their 60 s timeout. Half the CPUs per package keeps the machine busy without
 * starving any one test file.
 */
export const TEST_MAX_WORKERS = '50%';

/**
 * Vitest 5's file-system module cache (`node_modules/.vitest-cache`) reuses a module's transform
 * while its own source is unchanged, so an `import.meta.glob` result stays stale when a matching
 * file is added (C48). Transforms are a few percent of a run, so it stays off.
 */
export const TEST_FS_MODULE_CACHE = false;

/**
 * Builds a package's Vitest config: colocated `src/**\/*.test.ts(x)` tests,
 * v8 coverage over all of `src`, and an 80% gate on lines, branches,
 * functions and statements. `overrides` is deep-merged (arrays concatenate),
 * so packages can add plugins, setup files or exclusions but keep the gate.
 */
export function createVitestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  const base: ViteUserConfig = {
    resolve: { conditions: CLIENT_CONDITIONS },
    ssr: { resolve: { conditions: SERVER_CONDITIONS } },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'node',
      testTimeout: TEST_TIMEOUT_MS,
      hookTimeout: TEST_TIMEOUT_MS,
      maxWorkers: TEST_MAX_WORKERS,
      fsModuleCache: TEST_FS_MODULE_CACHE,
      coverage: {
        enabled: true,
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
        reporter: ['text', 'json-summary', 'lcov'],
        thresholds: {
          lines: COVERAGE_THRESHOLD,
          branches: COVERAGE_THRESHOLD,
          functions: COVERAGE_THRESHOLD,
          statements: COVERAGE_THRESHOLD,
        },
      },
    },
  };
  return mergeConfig(base, overrides) as ViteUserConfig;
}
