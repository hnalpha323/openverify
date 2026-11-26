/**
 * The key-value cache against a real Valkey (C54.3): TTLs are Valkey's own, and a capped push is
 * one MULTI, so concurrent pushes never leave the list longer than its cap.
 */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeRateLimitRedis } from '../rate-limit/index.js';
import { createCacheRedis, createKeyValueCache } from './index.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;

let valkey: StartedTestContainer;
let redis: ReturnType<typeof createCacheRedis>;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  redis = createCacheRedis(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
});

afterAll(async () => {
  await closeRateLimitRedis(redis);
  await valkey.stop();
});

describe('createKeyValueCache on Valkey', () => {
  it('sets, reads, expires and deletes values with Valkey TTLs', async () => {
    const cache = createKeyValueCache({ redis });

    await cache.set('openverify:cache:it:a', 'one', 120);

    await expect(cache.get('openverify:cache:it:a')).resolves.toBe('one');
    const ttl = await redis.ttl('openverify:cache:it:a');
    expect(ttl).toBeGreaterThan(110);
    expect(ttl).toBeLessThanOrEqual(120);
    await cache.delete('openverify:cache:it:a');
    await expect(cache.get('openverify:cache:it:a')).resolves.toBeNull();
  });

  it('keeps a capped list at its cap under concurrent pushes, newest first, with its TTL', async () => {
    const cache = createKeyValueCache({ redis });
    const key = 'openverify:sandbox-sms:env_it';

    await Promise.all(
      Array.from({ length: 50 }, (_, index) => cache.pushCapped(key, String(index), 10, 900)),
    );

    await expect(redis.llen(key)).resolves.toBe(10);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(890);
    const newest = await cache.listRange(key, 3);
    expect(newest).toHaveLength(3);
    await cache.pushCapped(key, 'latest', 10, 900);
    await expect(cache.listRange(key, 1)).resolves.toEqual(['latest']);
  });

  it('holds at most the limit of leases under concurrent takers, with the TTL (K8-8)', async () => {
    const cache = createKeyValueCache({ redis });
    const key = 'openverify:workflow-https-slot:it';

    const taken = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        cache.acquireLease(key, `lease-${String(index)}`, 5, 60),
      ),
    );

    expect(taken.filter(Boolean)).toHaveLength(5);
    await expect(redis.zcard(key)).resolves.toBe(5);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(50);
    const held = taken.flatMap((ok, index) => (ok ? [`lease-${String(index)}`] : []));
    await cache.releaseLease(key, held[0] ?? '');
    await expect(cache.acquireLease(key, 'late', 5, 60)).resolves.toBe(true);
  });
});
