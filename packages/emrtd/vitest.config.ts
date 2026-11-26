import { createVitestConfig } from '@openverify/config/vitest';

// C62.9: the self-test runs first, before any test file (vitest.global-setup.ts).
export default createVitestConfig({ test: { globalSetup: ['./vitest.global-setup.ts'] } });
