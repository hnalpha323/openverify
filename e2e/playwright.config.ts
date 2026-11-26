/**
 * Full-stack end-to-end tests (`pnpm e2e` from the repository root, or
 * `pnpm --filter @openverify/e2e e2e` once the workspace packages are built).
 *
 * The global setup starts a private stack: the compose infrastructure under its own project
 * name (`openverify-e2e`, never the developer's), the migrations and the dev seed, then the
 * API, the worker, the vision service, the hosted flow and the dashboard as local processes.
 * Service logs go to `e2e/.artifacts/logs/`. Specs read the stack's URLs and credentials with
 * `readStackInfo()`.
 */
import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

/** The console sweep's specs (Workflow 9C), run as their own project after the others. */
const CONSOLE_SWEEP_SPECS = ['**/a11y-console.spec.ts', '**/ui-csp.spec.ts'] as const;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './setup/global-setup.ts',
  outputDir: './.artifacts/test-results',
  // One browser at a time: Chromium's fake camera is process-wide, so each spec that plays a
  // clip launches its own browser (C45.3).
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  timeout: 5 * 60_000,
  // Workflow 5B: the full-stack suite took about 9 minutes locally; CI runners are slower. Workflow
  // 9D (R006): about 26 minutes locally (four chromium shards and the console sweep, load 2 to 3),
  // about 38 in CI at 9A's ratio of 1.45, so 60 keeps it outside the last 25% (Phase 8 F08).
  globalTimeout: 60 * 60_000,
  expect: { timeout: 30_000 },
  reporter: isCI
    ? [['github'], ['list'], ['html', { outputFolder: './.artifacts/report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: './.artifacts/report', open: 'never' }]],
  use: {
    locale: 'en-US',
    permissions: ['camera'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Workflow 9C (C170.3, C171.2): the console sweep (axe once per console page, the real-header
  // CSP on every page) is its own project and runs after every other spec, when the suite has made
  // an object of each kind for its dynamic pages. A shard runs `--project=chromium`; the sweep is
  // one call of its own: `--project=console-sweep --no-deps`.
  projects: [
    {
      name: 'chromium',
      testIgnore: [...CONSOLE_SWEEP_SPECS],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'console-sweep',
      testMatch: [...CONSOLE_SWEEP_SPECS],
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
