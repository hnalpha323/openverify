/**
 * C249.5 (B8-S1, B8-D1; Phase 11, Workflow 11B, platform-ops), against a real Valkey
 * (`valkey/valkey:9.1`): each process can connect as its own Valkey ACL user named in `REDIS_URL`
 * (`redis://<user>:<password>@host:port`, or `rediss://` with C249.1's CA), with the commands the
 * self-hosting guide denies to application users (`FLUSHALL`, `FLUSHDB`, `CONFIG` but its `GET`,
 * `DEBUG`, `KEYS`) refused. The rate limiter, the cache client and BullMQ work as that user, the
 * user cannot flush or reconfigure the store, and the worker's start check still reads
 * `maxmemory-policy` (kept from Phase 8, C117.10) and warns when it is not `noeviction`; with
 * `CONFIG GET` denied too, the check says it could not read the policy and the worker starts.
 * Every credential is synthetic.
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCacheRedis } from '../cache/index.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { createRateLimiter, createRateLimitRedis } from '../rate-limit/index.js';
import { checkValkeyAtStart } from '../worker.js';
import { checkValkeyEvictionPolicy } from '../workflows/engine/valkey-check.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const PASSWORD = 'synthetic-valkey-user-password';
/** The guide's application user: everything but the commands it denies, `CONFIG GET` allowed. */
const APPLICATION_ACL = [
  'on',
  `>${PASSWORD}`,
  '~*',
  '&*',
  '+@all',
  '-flushall',
  '-flushdb',
  '-config',
  '+config|get',
  '-debug',
  '-keys',
];

let valkey: StartedTestContainer;
let admin: Redis;
let host: string;
let port: number;
const opened: { quit(): Promise<unknown> }[] = [];

const urlOf = (user: string) => `redis://${user}:${PASSWORD}@${host}:${String(port)}`;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_TEST_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  host = valkey.getHost();
  port = valkey.getMappedPort(6379);
  admin = new Redis({ host, port, lazyConnect: true });
  await admin.connect();
  await admin.call('ACL', 'SETUSER', 'openverify-api', ...APPLICATION_ACL);
  await admin.call('ACL', 'SETUSER', 'openverify-worker', ...APPLICATION_ACL);
  await admin.call('ACL', 'SETUSER', 'openverify-no-config', ...APPLICATION_ACL, '-config');
});

afterAll(async () => {
  await Promise.all(opened.splice(0).map((client) => client.quit()));
  await admin.quit();
  await valkey.stop();
});

/** A client of `url` that the suite closes. */
function track<T extends { quit(): Promise<unknown> }>(client: T): T {
  opened.push(client);
  return client;
}

describe('a per-process Valkey user (C249.5)', () => {
  it('runs the rate limiter and the cache as the API user', async () => {
    const limiterRedis = track(createRateLimitRedis(urlOf('openverify-api')));
    const limiter = createRateLimiter({ redis: limiterRedis, logger: createCapturingLogger() });
    const decision = await limiter.consume('synthetic-caller', {
      name: 'api',
      limit: 2,
      windowSeconds: 60,
    });
    expect(decision).toMatchObject({ allowed: true, limit: 2, remaining: 1 });

    const cache = track(createCacheRedis(urlOf('openverify-api')));
    await cache.set('openverify:valkey-user-test', 'synthetic', 'EX', 60);
    expect(await cache.get('openverify:valkey-user-test')).toBe('synthetic');
    expect(await cache.call('ACL', 'WHOAMI')).toBe('openverify-api');
  });

  it('runs a BullMQ queue and worker as the worker user', async () => {
    const connection = { url: urlOf('openverify-worker') };
    const queue = new Queue('valkey-user-test', { connection });
    const done: string[] = [];
    const worker = new Worker(
      'valkey-user-test',
      (job) => {
        done.push(job.name);
        return Promise.resolve();
      },
      { connection },
    );
    try {
      const finished = new Promise<void>((resolve) => {
        worker.on('completed', () => {
          resolve();
        });
      });
      await queue.add('synthetic-job', {});
      await finished;
      expect(done).toEqual(['synthetic-job']);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('refuses the commands the guide denies to an application user', async () => {
    const client = track(createCacheRedis(urlOf('openverify-api')));
    for (const command of [
      ['FLUSHALL'],
      ['FLUSHDB'],
      ['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'],
      ['DEBUG', 'SLEEP', '0'],
      ['KEYS', '*'],
    ]) {
      // Valkey refuses DEBUG to every client unless enable-debug-command is set; the ACL denies it
      // as well, for a store that sets it.
      await expect(client.call(...(command as [string, ...string[]])), command[0]).rejects.toThrow(
        command[0] === 'DEBUG' ? /NOPERM|not allowed/ : /NOPERM/,
      );
    }
    expect(await admin.get('openverify:valkey-user-test')).toBe('synthetic');
  });

  it("keeps the worker's maxmemory-policy check as the worker user", async () => {
    const client = track(createCacheRedis(urlOf('openverify-worker')));
    const quiet = createCapturingLogger();
    await checkValkeyAtStart(() => checkValkeyEvictionPolicy(client, quiet), quiet);
    expect(quiet.entries).toEqual([]);

    await admin.call('CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru');
    try {
      const warned = createCapturingLogger();
      await checkValkeyAtStart(() => checkValkeyEvictionPolicy(client, warned), warned);
      expect(warned.entries.map(({ level, object }) => ({ level, object }))).toEqual([
        { level: 'error', object: { policy: 'allkeys-lru' } },
      ]);
    } finally {
      await admin.call('CONFIG', 'SET', 'maxmemory-policy', 'noeviction');
    }
  });

  it('starts when the user may not read CONFIG either, saying the policy was not checked', async () => {
    const client = track(createCacheRedis(urlOf('openverify-no-config')));
    const logger = createCapturingLogger();
    await checkValkeyAtStart(() => checkValkeyEvictionPolicy(client, logger), logger);
    expect(logger.entries.map(({ level, message }) => ({ level, message }))).toEqual([
      { level: 'error', message: 'Valkey eviction policy not checked' },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(PASSWORD);
  });
});
