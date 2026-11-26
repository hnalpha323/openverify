/**
 * C279.3's route collector (docs-catalog), run only as a child process by `route-table.ts`:
 * `node --experimental-transform-types --conditions=@openverify/source --import
 * ./scripts/register-ts.mjs src/catalog/route-table-collector.ts <repository root>`. It builds
 * the API app in memory exactly as `apps/api/src/openapi.test.ts` builds the app that writes
 * `docs/api/openapi.json` (the synthetic configuration with the sandbox SMS sender bound, no
 * database touched), records every route's method, URL, `config.scopes` and `config.public`
 * through an `onRoute` hook, and prints them, sorted, with the rate-limit plugin's route
 * constants as JSON on stdout. It writes nothing. The API's modules are loaded by computed
 * paths, so `tsc` does not type-check the API from this package.
 */
/* v8 ignore start -- run in a child process; route-table.test.ts and index.test.ts read its output */
interface RouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  readonly config?: { readonly scopes?: readonly string[]; readonly public?: boolean };
}
interface App {
  addHook(name: 'onRoute', hook: (route: RouteOptions) => void): void;
  ready(): Promise<unknown>;
}
interface Container {
  buildApp(options: { logger: boolean }): App;
  close(): Promise<void>;
}

const root = process.argv[2] ?? '';
const api = (file: string): string => `${root}/apps/api/src/${file}`;

const { createContainer } = (await import(api('container.ts'))) as {
  createContainer: (config: unknown, overrides: unknown) => Container;
};
const { loadConfig } = (await import(api('config.ts'))) as {
  loadConfig: (env: unknown) => unknown;
};
const { syntheticEnv } = (await import(api('test-support/env.ts'))) as {
  syntheticEnv: (overrides: Record<string, string>) => unknown;
};
const { createRecordingQueue } = (await import(api('test-support/fakes.ts'))) as {
  createRecordingQueue: () => object;
};
const plugin = (await import(api('plugins/rate-limit.ts'))) as Record<string, unknown>;

const container = createContainer(
  loadConfig(syntheticEnv({ OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox' })),
  {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  },
);
const routes: { method: string; url: string; scopes: string[] | null; public: boolean }[] = [];
const app = container.buildApp({ logger: false });
app.addHook('onRoute', (route) => {
  for (const method of typeof route.method === 'string' ? [route.method] : route.method) {
    routes.push({
      method,
      url: route.url,
      scopes: route.config?.scopes === undefined ? null : [...route.config.scopes],
      public: route.config?.public === true,
    });
  }
});
await app.ready();
const set = (value: unknown): string[] => [...(value as ReadonlySet<string>)].sort();
const key = (route: { method: string; url: string }): string => `${route.url} ${route.method}`;
process.stdout.write(
  JSON.stringify({
    routes: routes.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
    constants: {
      flowPrefix: plugin.FLOW_ROUTE_PREFIX,
      oneTimeLinkRedeem: plugin.ONE_TIME_LINK_REDEEM_ROUTE,
      signals: plugin.FLOW_SIGNALS_ROUTE,
      handoffs: plugin.FLOW_HANDOFFS_ROUTE,
      handoffTokenRoutes: set(plugin.HANDOFF_TOKEN_ROUTES),
      integrityRoutes: set(plugin.FLOW_INTEGRITY_ROUTES),
      sandboxChip: plugin.FLOW_SANDBOX_CHIP_ROUTE,
    },
  }),
);
await container.close();
/* v8 ignore stop */
