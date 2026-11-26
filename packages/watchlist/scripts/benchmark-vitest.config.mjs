// @ts-check
/**
 * The tests of the benchmark helpers (evaluation-6, plan C78.7 and C78.8). The package's own
 * Vitest config collects `src/**` only, so the helpers beside the benchmark scripts are tested
 * through this config, with the shared timeouts and the 80% coverage gate over the helper
 * modules. The benchmark CLIs and their Postgres harness need Docker and the data files: they are
 * run, not unit-tested.
 *
 *   pnpm --filter @openverify/watchlist benchmark:test
 */
import { createVitestConfig } from '@openverify/config/vitest';

/** The helper modules the coverage gate reads. */
export const BENCHMARK_HELPERS = Object.freeze([
  'scripts/benchmark-metrics.mjs',
  'scripts/benchmark-independence.mjs',
  'scripts/benchmark-tables.mjs',
  'scripts/benchmark-report.mjs',
  'scripts/benchmark-reads.mjs',
  'scripts/benchmark-paired.mjs',
  'scripts/benchmark-posthoc.mjs',
  'scripts/benchmark-variants.mjs',
  'scripts/benchmark-scale.mjs',
  'scripts/benchmark-write.mjs',
]);

const base = createVitestConfig();
const test = base.test ?? {};

/** @type {import('vitest/config').ViteUserConfig} */
const config = {
  ...base,
  test: {
    ...test,
    include: ['scripts/benchmark-*.test.mjs'],
    coverage: { ...test.coverage, include: [...BENCHMARK_HELPERS] },
  },
};

export default config;
