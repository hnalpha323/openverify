import { defineConfig } from 'vitest/config';
import {
  SOURCE_CONDITION,
  TEST_FS_MODULE_CACHE,
  TEST_MAX_WORKERS,
} from '@openverify/config/vitest';

// Integration tests start real containers (Docker required): `pnpm test:integration`.
// Coverage is gated by the unit-test config; this run only proves behaviour against Postgres.
// Workspace packages resolve to their sources, so a clean checkout (CI) needs no prior build.
export default defineConfig({
  resolve: { conditions: [SOURCE_CONDITION, 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, 'module', 'node', 'development|production'] } },
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // Each test file starts its own Postgres, and turbo runs this suite beside apps/api's: with
    // Vitest's default workers, 22 containers migrated at once on 12 CPUs (after Workflow 6B).
    maxWorkers: TEST_MAX_WORKERS,
    // Owner decision 19 after Workflow 7B: two suites starting together raced on the cache's folder.
    fsModuleCache: TEST_FS_MODULE_CACHE,
  },
});
