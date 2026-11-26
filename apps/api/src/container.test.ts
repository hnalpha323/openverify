import { getDefaultKeyring, setDefaultKeyring } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import {
  createContainer,
  WATCHLIST_RECONCILE_READY_WAIT_MS,
  type Container,
  type ContainerOverrides,
} from './container.js';
import {
  createInMemoryNetworkSnapshots,
  createInMemoryKeyValueCache,
  createRecordingQueue,
  createRecordingReportRunQueue,
  createRefusingOutboundHttp,
} from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: reconcile }));
// Workflow 7A (C92.5, C93.1): the network reconciliation and the trust-mode warnings, observed.
const reconcileNetwork = vi.hoisted(() => vi.fn());
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: reconcileNetwork }));
// C254.1 (Q10 granted; KP11-31): the reconcile's opt-in member, observed (it reads the database).
const reconcileOptIn = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock('./watchlists/un-opt-in.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./watchlists/un-opt-in.js')>()),
  watchlistReconcileOptIn: reconcileOptIn,
}));
const privatePeerWatch = vi.hoisted(() => ({ observe: vi.fn() }));
const warnOnPrivatePeers = vi.hoisted(() => vi.fn(() => privatePeerWatch));
vi.mock('./network/private-peers.js', () => ({ warnOnPrivatePeers }));

const containers: Container[] = [];

function fakeQueues() {
  const verificationQueue = { ...createRecordingQueue(), close: vi.fn(() => Promise.resolve()) };
  const webhookDeliveries = {
    scheduleDelivery: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { verificationQueue, webhookDeliveries };
}

function make(env: NodeJS.ProcessEnv = {}, overrides: ContainerOverrides = fakeQueues()) {
  const container = createContainer(loadConfig(syntheticEnv(env)), overrides);
  containers.push(container);
  return container;
}

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.close()));
  setDefaultKeyring(undefined);
});

describe('createContainer', () => {
  it('builds the adapters from the configuration without connecting to anything', () => {
    const container = make();

    expect(container.pool.options).toMatchObject({
      connectionString: 'postgres://openverify:synthetic@127.0.0.1:1/openverify',
    });
    expect(container.pool.totalCount).toBe(0);
    expect(container.storage).toHaveProperty('client');
    expect(typeof container.events.publish).toBe('function');
    expect(typeof container.vision.analyzeGovernmentId).toBe('function');
  });

  it('binds the API process providers from the configuration (C54.3, C63)', () => {
    const container = make({
      OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_DATABASE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_AAMVA_SANDBOX: 'sandbox',
    });

    expect(container.providers.sandbox).toEqual({
      sms: expect.objectContaining({ id: 'sandbox', sandbox: true }) as unknown,
      database: expect.objectContaining({ id: 'sandbox', sandbox: true }) as unknown,
      aamva: expect.objectContaining({ id: 'sandbox', sandbox: true }) as unknown,
    });
    expect(container.providers.production).toEqual({});
  });

  it('closes its report-run producer with the rest (C74.1)', async () => {
    const reportRuns = {
      ...createRecordingReportRunQueue(),
      close: vi.fn(() => Promise.resolve()),
    };
    const listImports = {
      enqueueListImport: () => Promise.resolve(),
      close: vi.fn(() => Promise.resolve()),
    };
    const listItemEmbeds = {
      enqueueListItemEmbed: () => Promise.resolve(),
      close: vi.fn(() => Promise.resolve()),
    };
    const container = make({}, { ...fakeQueues(), reportRuns, listImports, listItemEmbeds });

    await container.close();

    expect(reportRuns.close).toHaveBeenCalledTimes(1);
    expect(listImports.close).toHaveBeenCalledTimes(1);
    expect(listItemEmbeds.close).toHaveBeenCalledTimes(1);
  });

  it('closes its graph-query producer with the rest (C102.4)', async () => {
    const graphQueries = {
      enqueueGraphQuery: () => Promise.resolve(),
      close: vi.fn(() => Promise.resolve()),
    };
    const container = make({}, { ...fakeQueues(), graphQueries });

    await container.close();

    expect(graphQueries.close).toHaveBeenCalledTimes(1);
  });

  it('closes the key-value cache and the outbound client with the rest (C54.3)', async () => {
    const cache = { ...createInMemoryKeyValueCache(), close: vi.fn(() => Promise.resolve()) };
    const outboundHttp = {
      ...createRefusingOutboundHttp(),
      close: vi.fn(() => Promise.resolve()),
    };
    const container = make({}, { ...fakeQueues(), cache, outboundHttp });

    expect(container.cache).toBe(cache);
    expect(container.outboundHttp).toBe(outboundHttp);
    await container.close();

    expect(cache.close).toHaveBeenCalledTimes(1);
    expect(outboundHttp.close).toHaveBeenCalledTimes(1);
  });

  it('builds its own cache on a lazy Valkey client and closes it without connecting', async () => {
    const container = make();

    await expect(container.cache.get('openverify:cache:probe')).rejects.toThrow();
    await expect(container.close()).resolves.toBeUndefined();
  });

  it('installs the configured keyring for the encrypted columns', () => {
    const container = make();

    expect(getDefaultKeyring()).toBe(container.config.keyring);
  });

  it('serves the server, flow and dashboard APIs on one app', async () => {
    const app = make().buildApp();

    const document = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/v1/inquiries',
        '/api/v1/flow/session',
        '/api/v1/dashboard/me',
      ]),
    );
  });

  it('applies the configured CORS origins and proxy trust', async () => {
    const app = make({
      OPENVERIFY_FLOW_CORS_ORIGINS: 'https://other-flow.example.test',
      OPENVERIFY_TRUST_PROXY: 'true',
    }).buildApp();
    app.get('/ip-probe', { config: { public: true } }, (request) => ({ ip: request.ip }));

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/flow/session',
      headers: {
        origin: 'https://other-flow.example.test',
        'access-control-request-method': 'GET',
      },
    });
    const probe = await app.inject({
      url: '/ip-probe',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://other-flow.example.test',
    );
    expect(probe.json()).toEqual({ ip: '203.0.113.9' });
  });

  it('ignores X-Forwarded-For unless told to trust the proxy', async () => {
    const app = make().buildApp();
    app.get('/ip-probe', { config: { public: true } }, (request) => ({ ip: request.ip }));

    const probe = await app.inject({
      url: '/ip-probe',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });

    expect(probe.json()).toEqual({ ip: '10.0.0.1' });
  });

  it('closes the pool, the storage and the queues once', async () => {
    const queues = fakeQueues();
    const container = make({}, queues);

    await container.close();
    await container.close();

    expect(container.pool.ended).toBe(true);
    expect(queues.verificationQueue.close).toHaveBeenCalledOnce();
    expect(queues.webhookDeliveries.close).toHaveBeenCalledOnce();
  });

  it('closes everything it can and reports every failure', async () => {
    const queues = fakeQueues();
    queues.verificationQueue.close.mockRejectedValueOnce(new Error('valkey gone'));
    const container = make({}, queues);

    const closed = container.close();

    await expect(closed).rejects.toBeInstanceOf(AggregateError);
    await expect(closed).rejects.toMatchObject({ errors: [new Error('valkey gone')] });
    expect(queues.webhookDeliveries.close).toHaveBeenCalledOnce();
    expect(container.pool.ended).toBe(true);
    containers.splice(containers.indexOf(container), 1);
  });

  it('builds a Valkey rate limiter that connects on first use, fails fast and closes', async () => {
    const container = make();
    const rule = { name: 'api', limit: 300, windowSeconds: 60 } as const;

    const started = Date.now();
    await expect(container.rateLimiter.consume('key_probe', rule)).rejects.toThrow();
    await expect(container.rateLimiter.consume('key_probe', rule)).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(5_000);
    await container.close();
  });

  it('uses an injected rate limiter', () => {
    const rateLimiter = { consume: vi.fn() };

    const container = make({}, { ...fakeQueues(), rateLimiter });

    expect(container.rateLimiter).toBe(rateLimiter);
  });

  it('logs an idle connection the database ended instead of crashing the process', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const container = make({}, { ...fakeQueues(), logger });
    const lost = Object.assign(new Error('terminating connection due to administrator command'), {
      name: 'DatabaseError',
      code: '57P01',
    });

    expect(() => container.pool.emit('error', lost)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      { error: 'DatabaseError', code: '57P01' },
      'database connection lost',
    );
  });

  it('uses injected adapters instead of building them', () => {
    const queues = fakeQueues();
    const clock = { now: () => new Date('2026-10-20T12:00:00.000Z') };

    const container = make({}, { ...queues, clock });

    expect(container.queue).toBe(queues.verificationQueue);
    expect(container.clock).toBe(clock);
  });
});

describe('the watchlist sources at API startup (C76.4, V01)', () => {
  it('reconciles the source rows from the manifest once the app is ready', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 0, enabled: 0, retired: 0 });
    const container = make({ OPENVERIFY_WATCHLIST_SOURCES_DISABLED: 'un-sc, ofac-consolidated' });

    await container.buildApp({ logger: false }).ready();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0]?.[1]).toMatchObject({
      disabled: ['un-sc', 'ofac-consolidated'],
    });
  });

  it('passes the opted-in sources to the reconcile while the install allows the UN opt-in (Q10)', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 0, enabled: 0, retired: 0 });
    reconcileOptIn.mockReset().mockResolvedValue({ optInSources: ['un-sc'] });
    const container = make({ OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'true' });

    await container.buildApp({ logger: false }).ready();

    expect(reconcileOptIn).toHaveBeenCalledWith(expect.anything(), true);
    expect(reconcile.mock.calls[0]?.[1]).toMatchObject({ optInSources: ['un-sc'] });
  });

  it('asks for no opt-in source while the install does not allow it', async () => {
    reconcile.mockReset().mockResolvedValue({ sources: 0, enabled: 0, retired: 0 });
    reconcileOptIn.mockReset().mockResolvedValue({});
    const container = make({ OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: 'false' });

    await container.buildApp({ logger: false }).ready();

    expect(reconcileOptIn).toHaveBeenCalledWith(expect.anything(), false);
    expect(reconcile.mock.calls[0]?.[1]).not.toHaveProperty('optInSources');
  });

  it('starts all the same when the reconciliation fails, and says so', async () => {
    reconcile.mockReset().mockRejectedValue(new Error('synthetic outage'));

    await expect(make().buildApp({ logger: false }).ready()).resolves.toBeDefined();
  });

  // Phase 6 orchestrator: under a load average of 11, the reconciliation took 11 s and Fastify's
  // onReady hook timeout (10 s) stopped the API. The rows are not needed to serve.
  it('is ready without waiting past its deadline for a slow reconciliation, and says so', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      reconcile.mockReset().mockReturnValue(new Promise(() => undefined));
      const lines: Record<string, unknown>[] = [];
      const stream = {
        write(line: string) {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      };
      let ready = false;
      // The network snapshots load from the database too (C92.3); here they are in memory, so
      // only the watchlist reconciliation is slow.
      void make({}, { ...fakeQueues(), networkSnapshots: createInMemoryNetworkSnapshots() })
        .buildApp({ logger: { level: 'warn', stream } })
        .ready()
        .then(() => {
          ready = true;
        });

      await vi.advanceTimersByTimeAsync(WATCHLIST_RECONCILE_READY_WAIT_MS - 1);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(ready).toBe(true);
      expect(lines).toContainEqual(
        expect.objectContaining({
          level: 40,
          msg: 'watchlist sources still reconciling; the API is ready without them',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the network data of the API process (Workflow 7A: C92.3, C92.5, C93.1, C93.2, F41)', () => {
  it('reconciles the sources with the lists and starts the snapshots when ready, and closes them', async () => {
    reconcileNetwork.mockReset().mockResolvedValue({ upserted: 11, disabled: 1 });
    const networkSnapshots = createInMemoryNetworkSnapshots();
    const container = make(
      { OPENVERIFY_NETWORK_SOURCES_DISABLED: 'gcp-cloud' },
      { ...fakeQueues(), networkSnapshots },
    );

    await container.buildApp({ logger: false }).ready();

    expect(reconcileNetwork).toHaveBeenCalledWith(
      container.db,
      expect.objectContaining({ sourcesDisabled: ['gcp-cloud'], sourcesEnabled: [] }),
    );
    expect(networkSnapshots.started).toBe(true);
    expect(container.networkSnapshots).toBe(networkSnapshots);
    await container.close();
    expect(networkSnapshots.closed).toBe(true);
  });

  it('is ready when reconciliation or the first load fails, logging the error name', async () => {
    reconcileNetwork.mockReset().mockRejectedValue(new TypeError('synthetic outage'));
    const networkSnapshots = {
      ...createInMemoryNetworkSnapshots(),
      start: () => Promise.reject(new RangeError('synthetic load failure')),
    };

    await expect(
      make({}, { ...fakeQueues(), networkSnapshots })
        .buildApp({ logger: false })
        .ready(),
    ).resolves.toBeDefined();
  });

  it('gives each session evaluation the snapshots, the API providers, the trust mode and the watch', () => {
    warnOnPrivatePeers.mockClear();
    const networkSnapshots = createInMemoryNetworkSnapshots();
    const container = make(
      { OPENVERIFY_TRUST_PROXY: '2', OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'sandbox' },
      { ...fakeQueues(), networkSnapshots },
    );

    expect(container.sessionNetwork).toMatchObject({
      snapshots: networkSnapshots,
      providers: container.providers,
      trustProxy: 2,
      privatePeers: privatePeerWatch,
    });
    expect(container.providers.sandbox.ipReputation).toMatchObject({ id: 'sandbox' });
    expect(warnOnPrivatePeers).toHaveBeenCalledTimes(1);
    expect(warnOnPrivatePeers).toHaveBeenCalledWith(expect.anything(), 2);
  });
});
