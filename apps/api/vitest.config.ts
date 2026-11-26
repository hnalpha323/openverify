import { configDefaults } from 'vitest/config';
import { createVitestConfig, SOURCE_CONDITION } from '@openverify/config/vitest';

// Unit tests only; `*.integration.test.ts` needs Docker and runs via `test:integration`.
// PGlite (`@openverify/db/testing`) needs a few seconds to start in each test file, more
// when many files start it in parallel, hence the longer hook timeout: two test databases that
// take about 8 s alone passed 60 s under the full validation's load after Workflow 6B.
const config = createVitestConfig({
  test: {
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    hookTimeout: 120_000,
  },
});

// The AWS SDK maps the `module` export condition to a bundler-only build whose imports have no
// file extensions, which Node cannot load. Resolve server-side imports as Node does instead.
config.ssr = {
  ...config.ssr,
  resolve: {
    ...config.ssr?.resolve,
    conditions: [SOURCE_CONDITION, 'node', 'development|production'],
  },
};

export default config;
