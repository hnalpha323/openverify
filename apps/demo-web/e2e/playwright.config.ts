import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * The sample site's own end-to-end spec (C266.3) against a fake installation on loopback ports.
 * Playwright is the e2e package's: `pnpm --filter @openverify/demo-web e2e` runs it from there with
 * `e2e/tsconfig.runtime.json`, which maps `@playwright/test` to that copy's ES module (this
 * directory's `tsconfig.json` maps it to its types). Build first, under the e2e lock:
 * `pnpm turbo run build --filter=@openverify/demo-web...`.
 */
const config: PlaywrightTestConfig = {
  testDir: '.',
  outputDir: join(tmpdir(), 'openverify-demo-web-e2e'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
export default config;
