/**
 * `apps/demo-web` (plan C266.3): a sample customer site, never published. Its server's parts, for
 * tooling that starts it in-process (the page's entry is `src/page/main.tsx`, the server's
 * `src/server/main.ts`).
 */
export {
  DEMO_DEFAULT_LISTEN,
  DemoConfigError,
  readDemoConfig,
  type DemoConfig,
} from './server/config.ts';
export {
  createDemoHandler,
  startDemoServer,
  type DemoResult,
  type DemoServerOptions,
} from './server/app.ts';
