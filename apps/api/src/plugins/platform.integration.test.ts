/**
 * C12 platform behaviour against real services: Postgres 17 + pgvector and Valkey, started
 * with Testcontainers. Two API instances are composed by `createContainer` from the same
 * configuration, as two replicas behind a load balancer would be, and share both stores:
 * - one GCRA limit holds across the instances;
 * - of concurrent requests with one idempotency key, exactly one runs.
 * Only the BullMQ queues are recorded instead of sent. Every value is synthetic.
 */
import { API_SCOPES, newId } from '@openverify/contracts';
import {
  createApiKey,
  createEnvironment,
  createOrganization,
  generateApiKey,
  listWebhooks,
  runMigrations,
  setDefaultKeyring,
} from '@openverify/db';
import { startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer, type Container } from '../container.js';
import { createRecordingQueue } from '../test-support/fakes.js';
import { syntheticEnv } from '../test-support/env.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';

let postgres: StartedPostgreSqlContainer;
let valkey: StartedTestContainer;
const containers: Container[] = [];

beforeAll(async () => {
  [postgres, valkey] = await Promise.all([
    startIntegrationPostgres(),
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
});

afterAll(async () => {
  await Promise.all(containers.map((container) => container.close()));
  await Promise.all([ifSet(postgres)?.stop(), ifSet(valkey)?.stop()]);
  setDefaultKeyring(undefined);
});

/** One API instance on the shared Postgres and Valkey, with the given api limit. */
function instance(apiPerMinute: number): Container {
  const config = loadConfig(
    syntheticEnv({
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`,
      OPENVERIFY_API_KEY_PEPPER: PEPPER,
      OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
      OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: String(apiPerMinute),
    }),
  );
  const container = createContainer(config, {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  });
  containers.push(container);
  return container;
}

let migrated = false;

/** Two instances sharing the stores, and a fresh environment with two all-scope API keys. */
async function replicas(apiPerMinute: number) {
  const first = instance(apiPerMinute);
  const second = instance(apiPerMinute);
  if (!migrated) {
    await runMigrations(first.db);
    migrated = true;
  }
  const organization = await createOrganization(first.db, {
    id: newId('org'),
    name: 'Platform Integration Org',
  });
  const environment = await createEnvironment(first.db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const newKey = async () => {
    const key = generateApiKey('sandbox', new TextEncoder().encode(PEPPER));
    await createApiKey(first.db, environment.id, {
      id: newId('key'),
      name: 'Platform integration key',
      prefix: key.prefix,
      secretHash: key.secretHash,
      tokenPrefix: key.tokenPrefix,
      scopes: API_SCOPES,
    });
    return key.token;
  };
  return { first, second, environmentId: environment.id, tokens: [await newKey(), await newKey()] };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The instance that serves request `index`: the two take turns. */
const alternate = (apps: readonly [FastifyInstance, FastifyInstance], index: number) =>
  index % 2 === 0 ? apps[0] : apps[1];

describe('GCRA rate limits across API instances (C12)', () => {
  it('holds one limit for a key whichever instance serves it', async () => {
    const { first, second, tokens } = await replicas(5);
    const apps = [first.buildApp({ logger: false }), second.buildApp({ logger: false })] as const;
    const [token, otherToken] = tokens as [string, string];

    const responses: LightMyRequestResponse[] = [];
    for (let index = 0; index < 8; index += 1) {
      const app = alternate(apps, index);
      responses.push(await app.inject({ url: '/api/v1/rate-limits', headers: bearer(token) }));
    }
    const other = await apps[1].inject({
      url: '/api/v1/rate-limits',
      headers: bearer(otherToken),
    });

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200, 429, 429, 429,
    ]);
    expect(
      responses.slice(0, 5).map((response) => response.headers['ratelimit-remaining']),
    ).toEqual(['4', '3', '2', '1', '0']);
    for (const refused of responses.slice(5)) {
      expect(refused.headers['ratelimit-limit']).toBe('5');
      // One request every 12 s refills a window of 5 per minute.
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(12);
      expect(refused.json()).toMatchObject({
        type: 'https://openverify.dev/problems/rate-limited',
      });
    }
    expect(other.statusCode).toBe(200);
    expect(other.headers['ratelimit-remaining']).toBe('4');
    await Promise.all(apps.map((app) => app.close()));
  });
});

describe('idempotency across API instances (C12)', () => {
  it('runs exactly one of concurrent requests with the same key', async () => {
    const { first, second, tokens } = await replicas(1_000);
    let executions = 0;
    // The running request holds until every other one has been answered, whatever the load: on a
    // clock, a slow enough machine serves them after it finishes, and they are replays instead.
    const others = 9;
    let answered = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowRoute = (app: FastifyInstance) => {
      void app.register((scope, _options, done) => {
        scope.post('/api/v1/slow-things', { config: { scopes: [] } }, async (_request, reply) => {
          executions += 1;
          await held;
          return reply.code(201).send({ data: { type: 'thing', id: 'thg_slow' } });
        });
        done();
      });
      return app;
    };
    const apps = [
      slowRoute(first.buildApp({ logger: false })),
      slowRoute(second.buildApp({ logger: false })),
    ] as const;

    const responses = await Promise.all(
      Array.from({ length: others + 1 }, async (_, index) => {
        const response = await alternate(apps, index).inject({
          method: 'POST',
          url: '/api/v1/slow-things',
          headers: { ...bearer(tokens[0] ?? ''), 'idempotency-key': 'concurrent-slow-1' },
          payload: { same: 'body' },
        });
        answered += 1;
        if (answered === others) {
          release();
        }
        return response;
      }),
    );
    const retry = await apps[1].inject({
      method: 'POST',
      url: '/api/v1/slow-things',
      headers: { ...bearer(tokens[0] ?? ''), 'idempotency-key': 'concurrent-slow-1' },
      payload: { same: 'body' },
    });

    const original = responses.filter(
      (response) =>
        response.statusCode === 201 && response.headers['idempotent-replayed'] === undefined,
    );
    const inUse = responses.filter((response) => response.statusCode === 409);
    expect(executions).toBe(1);
    expect(original).toHaveLength(1);
    expect(inUse).toHaveLength(others);
    for (const response of inUse) {
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/idempotency-key-in-use',
      });
    }
    expect(responses.every((response) => [201, 409].includes(response.statusCode))).toBe(true);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toBe(original[0]?.body);
    await Promise.all(apps.map((app) => app.close()));
  });

  it('creates one webhook for concurrent creations with the same key', async () => {
    const { first, second, tokens, environmentId } = await replicas(1_000);
    const apps = [first.buildApp({ logger: false }), second.buildApp({ logger: false })] as const;

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        alternate(apps, index).inject({
          method: 'POST',
          url: '/api/v1/webhooks',
          headers: { ...bearer(tokens[1] ?? ''), 'idempotency-key': 'concurrent-webhook-1' },
          payload: {
            data: {
              type: 'webhook',
              attributes: { url: 'https://hooks.example.test/one', 'enabled-events': ['*'] },
            },
          },
        }),
      ),
    );

    const page = await listWebhooks(first.db, environmentId, { size: 100 });
    expect(page.items).toHaveLength(1);
    const created = responses.filter((response) => response.statusCode === 201);
    expect(
      new Set(created.map((response) => response.json<{ data: { id: string } }>().data.id)),
    ).toEqual(new Set([page.items[0]?.id]));
    expect(responses.every((response) => [201, 409].includes(response.statusCode))).toBe(true);
    await Promise.all(apps.map((app) => app.close()));
  });
});
