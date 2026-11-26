import { createVitestConfig } from '@openverify/config/vitest';

// Unit tests of the harness library in src/ (environment, ports, processes, webhook receiver).
// The Playwright specs in tests/ run the whole stack: `pnpm e2e`.
export default createVitestConfig();
