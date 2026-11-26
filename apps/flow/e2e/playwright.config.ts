import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices, firefox, webkit } from '@playwright/test';
import { API_ORIGIN } from './support/mock-flow-api';

const isCI = Boolean(process.env.CI);

const INSTALLED = { firefox, webkit } as const;
type Engine = keyof typeof INSTALLED;

/**
 * Whether `engine` is installed here and starts (Workflow 9C): a browser downloaded onto a host
 * that lacks its system libraries (WebKit on this machine) is installed but never launches, and
 * must be skipped like a missing one rather than fail every run.
 */
async function launches(engine: Engine): Promise<boolean> {
  if (!existsSync(INSTALLED[engine].executablePath())) {
    return false;
  }
  try {
    const browser = await INSTALLED[engine].launch();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * The extra engines of the theme CSP spec: always in CI, else those that start here. Workers load
 * this file again and inherit the main process's answer. `OPENVERIFY_FLOW_E2E_ENGINES=webkit` with
 * `PW_TEST_CONNECT_WS_ENDPOINT` runs WebKit here through Playwright's browser server in Docker,
 * without its host libraries (Workflow 9D, K9-35; the recipe is in `theme-csp.spec.ts` and
 * `README.md`).
 */
const ENGINES: readonly Engine[] = isCI
  ? ['firefox', 'webkit']
  : process.env.OPENVERIFY_FLOW_E2E_ENGINES !== undefined
    ? (['firefox', 'webkit'] as const).filter((engine) =>
        process.env.OPENVERIFY_FLOW_E2E_ENGINES?.split(',').includes(engine),
      )
    : (
        await Promise.all(
          (['firefox', 'webkit'] as const).map(async (engine) =>
            (await launches(engine)) ? [engine] : [],
          ),
        )
      ).flat();
process.env.OPENVERIFY_FLOW_E2E_ENGINES = ENGINES.join(',');

/** A free port, so this suite never collides with other servers on the machine. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('No port assigned'));
        }
      });
    });
  });
}

// Workers load this file again: they inherit the port chosen by the main process.
const PORT = Number(process.env.OPENVERIFY_FLOW_E2E_PORT ?? (await freePort()));
process.env.OPENVERIFY_FLOW_E2E_PORT = String(PORT);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    trace: 'on-first-retry',
    permissions: ['camera'],
    launchOptions: {
      // Chromium's synthetic camera (a moving test pattern, no real face) and auto-accepted prompt.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // C160.9 (Workflow 9B, review F19): the theme CSP spec in Firefox and WebKit too. CI installs
    // both and always runs them; a machine where one is missing or does not start skips it.
    // Neither engine takes Chromium's fake-camera flags or the camera permission.
    ...[
      {
        name: 'firefox',
        testMatch: 'theme-csp.spec.ts',
        use: { ...devices['Desktop Firefox'], permissions: [], launchOptions: { args: [] } },
      },
      {
        name: 'webkit',
        testMatch: 'theme-csp.spec.ts',
        use: { ...devices['Desktop Safari'], permissions: [], launchOptions: { args: [] } },
      },
    ].filter((project) => ENGINES.some((engine) => engine === project.name)),
  ],
  // Test the production bundle (with its CSP), served by `vite preview` from the app root. The
  // API is mocked per test with page.route on API_ORIGIN.
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { VITE_OPENVERIFY_API_URL: API_ORIGIN },
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
