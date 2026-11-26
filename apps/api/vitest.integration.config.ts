import { configDefaults, defineConfig } from 'vitest/config';
import {
  SOURCE_CONDITION,
  TEST_FS_MODULE_CACHE,
  TEST_MAX_WORKERS,
} from '@openverify/config/vitest';

/** C102.8: its 100,000-account graph is built once by its project's global setup. */
const GRAPH_ENGINE = 'src/services/graph/graph-engine.integration.test.ts';

// Integration tests start real containers (Docker required): `pnpm test:integration`.
// Coverage is gated by the unit-test config; this run only proves behaviour against Postgres,
// RustFS and the other real adapters. Workspace packages resolve to their sources, and server
// imports resolve as Node does (see vitest.config.ts for why `module` is left out).
export default defineConfig({
  resolve: { conditions: [SOURCE_CONDITION, 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, 'node', 'development|production'] } },
  // A global setup is imported in Vitest's own process, through its `__vitest__` environment.
  environments: {
    __vitest__: { resolve: { conditions: [SOURCE_CONDITION, 'node', 'development|production'] } },
  },
  test: {
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // Each test file starts its own containers, and turbo runs this suite beside packages/db's:
    // with Vitest's default workers, 22 Postgres containers migrated at once on 12 CPUs.
    maxWorkers: TEST_MAX_WORKERS,
    // Owner decision 19 after Workflow 7B: two suites starting together raced on the cache's folder.
    fsModuleCache: TEST_FS_MODULE_CACHE,
    // Owner decision 17 after Workflow 7B: the graph-engine file is a project of its own, so its
    // global setup (the graph's template database, `vitest.graph-template.ts`) runs only in a run
    // that holds the file, and before any file starts.
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          include: ['src/**/*.integration.test.ts'],
          exclude: [...configDefaults.exclude, GRAPH_ENGINE],
        },
      },
      {
        extends: true,
        test: {
          name: 'graph',
          include: [GRAPH_ENGINE],
          globalSetup: ['./vitest.graph-template.ts'],
        },
      },
    ],
  },
});
