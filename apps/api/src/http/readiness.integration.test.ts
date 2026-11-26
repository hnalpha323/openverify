/**
 * C250.1 (Phase 11, Workflow 11B, platform-ops), against a real Postgres 17 and Valkey 9.1: `/ready`
 * answers 200 while the API's pool and cache client reach their stores, then 503 naming Valkey once
 * its container is stopped, and 503 naming both once Postgres is stopped too, without an error's
 * text (the 1 s deadlines are `readiness.test.ts`', on fake timers).
 */
import { createDatabase } from '@openverify/db';
import { startIntegrationPostgres } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCacheRedis, createKeyValueCache } from '../cache/index.js';
import { systemRoutes } from '../routes/system.js';
import { readinessProbesOf } from './readiness.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';
import { storePool } from '../test-support/store-pool.js';

let postgres: StartedPostgreSqlContainer;
let valkey: StartedTestContainer;
let pool: Pool;
let redis: Redis;
let app: FastifyInstance;

beforeAll(async () => {
  [postgres, valkey] = await Promise.all([
    startIntegrationPostgres(),
    new GenericContainer(VALKEY_TEST_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  // A stopped store ends idle connections: their errors are what /ready reports, not a crash.
  pool = storePool(postgres.getConnectionUri());
  redis = createCacheRedis(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(systemRoutes, {
    version: '0.0.0-synthetic',
    readiness: readinessProbesOf({
      db: createDatabase(pool),
      cache: createKeyValueCache({ redis }),
    }),
  });
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await pool.end();
  await Promise.allSettled([valkey.stop(), postgres.stop()]);
});

async function ready() {
  const response = await app.inject({ method: 'GET', url: '/ready' });
  return { status: response.statusCode, body: response.json<unknown>() };
}

describe('GET /ready against real stores (C250.1)', () => {
  it('is ready, then names Valkey once it is down, then both once Postgres is down too', async () => {
    expect(await ready()).toMatchObject({ status: 200, body: { status: 'ready' } });

    await valkey.stop();
    const withoutValkey = await ready();
    expect(withoutValkey).toMatchObject({
      status: 503,
      body: { status: 'not_ready', checks: { postgres: 'ok', valkey: 'unavailable' } },
    });

    await postgres.stop();
    const withoutEither = await ready();
    expect(withoutEither).toMatchObject({
      status: 503,
      body: { status: 'not_ready', checks: { postgres: 'unavailable', valkey: 'unavailable' } },
    });
    expect(JSON.stringify(withoutEither.body)).not.toMatch(/ECONN|refused|terminat/i);
  });
});
