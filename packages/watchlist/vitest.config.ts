import { createVitestConfig } from '@openverify/config/vitest';
import { BENCHMARK_HELPERS } from './scripts/benchmark-vitest.config.mjs';

// The benchmark helpers' tests run with the package, and their modules join its coverage gate
// (owner decision 8 after Workflow 6B). The benchmark CLIs need Docker and the data files: they
// are run, not unit-tested.
export default createVitestConfig({
  test: {
    include: ['scripts/benchmark-*.test.mjs'],
    coverage: { include: [...BENCHMARK_HELPERS] },
  },
});
