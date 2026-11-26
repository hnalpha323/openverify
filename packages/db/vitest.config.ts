import { configDefaults } from 'vitest/config';
import { createVitestConfig } from '@openverify/config/vitest';

// Unit tests only; `*.integration.test.ts` needs Docker and runs via `test:integration`.
// PGlite (`@openverify/db/testing`) needs a few seconds to start in each test file, more
// when many files start it in parallel, hence the longer hook timeout: two test databases that
// take about 8 s alone passed 60 s under the full validation's load after Workflow 6B.
export default createVitestConfig({
  test: {
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    hookTimeout: 120_000,
  },
});
