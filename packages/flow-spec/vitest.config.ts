import { createVitestConfig } from '@openverify/config/vitest';

export default createVitestConfig({
  // Shared test fixtures are not product code.
  test: { coverage: { exclude: ['src/test-fixtures.ts'] } },
});
