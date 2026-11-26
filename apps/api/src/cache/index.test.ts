import { describe, expect, it } from 'vitest';
import { createKeyValueCache, type CacheMulti, type CacheRedis } from './index.js';

/** An in-memory stand-in for the part of ioredis the cache uses; TTLs are recorded, not run. */
function fakeRedis(status = 'ready') {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const ttls = new Map<string, number>();
  const sorted = new Map<string, Map<string, number>>();
  const zset = (key: string) => {
    const held = sorted.get(key) ?? new Map<string, number>();
    sorted.set(key, held);
    return held;
  };
  const commands: string[] = [];
  let failExec = false;
  const redis: CacheRedis & { status: string } = {
    status,
    get: (key) => {
      commands.push(`GET ${key}`);
      return Promise.resolve(strings.get(key) ?? null);
    },
    set: (key, value, mode, seconds) => {
      commands.push(`SET ${key} ${mode} ${String(seconds)}`);
      strings.set(key, value);
      ttls.set(key, seconds);
      return Promise.resolve('OK');
    },
    del: (key) => {
      commands.push(`DEL ${key}`);
      const existed = strings.delete(key) || lists.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    },
    zrem: (key, member) => {
      commands.push(`ZREM ${key}`);
      return Promise.resolve(zset(key).delete(member) ? 1 : 0);
    },
    lrange: (key, start, stop) => {
      commands.push(`LRANGE ${key} ${String(start)} ${String(stop)}`);
      return Promise.resolve((lists.get(key) ?? []).slice(start, stop + 1));
    },
    multi() {
      const queued: (() => unknown)[] = [];
      const multi: CacheMulti = {
        zremrangebyscore(key, min, max) {
          queued.push(() => {
            const bound = (value: number | string) =>
              value === '-inf' ? -Infinity : value === '+inf' ? Infinity : Number(value);
            for (const [member, score] of zset(key)) {
              if (score >= bound(min) && score <= bound(max)) zset(key).delete(member);
            }
          });
          return multi;
        },
        zadd(key, score, member) {
          queued.push(() => zset(key).set(member, score));
          return multi;
        },
        zcard(key) {
          queued.push(() => zset(key).size);
          return multi;
        },
        lpush(key, value) {
          queued.push(() => lists.set(key, [value, ...(lists.get(key) ?? [])]));
          return multi;
        },
        ltrim(key, start, stop) {
          queued.push(() => lists.set(key, (lists.get(key) ?? []).slice(start, stop + 1)));
          return multi;
        },
        expire(key, seconds) {
          queued.push(() => ttls.set(key, seconds));
          return multi;
        },
        exec() {
          commands.push(`EXEC ${String(queued.length)}`);
          if (failExec) {
            return Promise.resolve([[new Error('synthetic failure'), null]]);
          }
          return Promise.resolve(
            queued.map((run): [Error | null, unknown] => [null, run() ?? 'OK']),
          );
        },
      };
      return multi;
    },
  };
  return {
    redis,
    lists,
    ttls,
    sorted,
    commands,
    failNextExec: () => {
      failExec = true;
    },
  };
}

const KEY = 'openverify:cache:test:abc';

describe('createKeyValueCache (C54.3)', () => {
  it('stores a value with its TTL and reads it back; a missing key reads null', async () => {
    const { redis, ttls } = fakeRedis();
    const cache = createKeyValueCache({ redis });

    await cache.set(KEY, 'value', 3600);

    await expect(cache.get(KEY)).resolves.toBe('value');
    await expect(cache.get(`${KEY}:other`)).resolves.toBeNull();
    expect(ttls.get(KEY)).toBe(3600);
  });

  it('deletes a key', async () => {
    const { redis } = fakeRedis();
    const cache = createKeyValueCache({ redis });
    await cache.set(KEY, 'value', 60);

    await cache.delete(KEY);

    await expect(cache.get(KEY)).resolves.toBeNull();
  });

  it('keeps the newest entries of a capped list, newest first, with the list TTL, in one transaction', async () => {
    const { redis, lists, ttls, commands } = fakeRedis();
    const cache = createKeyValueCache({ redis });

    for (const value of ['a', 'b', 'c', 'd']) {
      await cache.pushCapped(KEY, value, 3, 900);
    }

    expect(lists.get(KEY)).toEqual(['d', 'c', 'b']);
    expect(ttls.get(KEY)).toBe(900);
    expect(commands.filter((command) => command.startsWith('EXEC'))).toEqual(
      Array(4).fill('EXEC 3'),
    );
    await expect(cache.listRange(KEY, 2)).resolves.toEqual(['d', 'c']);
  });

  it('rejects a capped push whose transaction failed', async () => {
    const { redis, failNextExec } = fakeRedis();
    const cache = createKeyValueCache({ redis });
    failNextExec();

    await expect(cache.pushCapped(KEY, 'a', 3, 900)).rejects.toThrow(
      'The cache transaction failed',
    );
  });

  it('takes at most the limit of leases in one transaction, lapses them by score and gives one back (K8-8)', async () => {
    const { redis, ttls, commands } = fakeRedis();
    let now = 1_000_000;
    const cache = createKeyValueCache({ redis, now: () => now });

    for (const lease of ['a', 'b']) {
      await expect(cache.acquireLease(KEY, lease, 2, 60)).resolves.toBe(true);
    }
    await expect(cache.acquireLease(KEY, 'c', 2, 60)).resolves.toBe(false);
    expect(ttls.get(KEY)).toBe(60);
    expect(commands.filter((command) => command.startsWith('EXEC'))).toEqual(
      Array(3).fill('EXEC 4'),
    );
    await cache.releaseLease(KEY, 'a');
    await expect(cache.acquireLease(KEY, 'c', 2, 60)).resolves.toBe(true);
    now += 60_000;
    // `b` and `c` lapsed: a crashed holder frees its place.
    await expect(cache.acquireLease(KEY, 'd', 1, 60)).resolves.toBe(true);
    await expect(cache.acquireLease(KEY, 'e', 1, 60)).resolves.toBe(false);
  });

  it('rejects a lease whose transaction failed, and refuses a limit that is not whole and positive', async () => {
    const { redis, failNextExec } = fakeRedis();
    const cache = createKeyValueCache({ redis });
    await expect(cache.acquireLease(KEY, 'a', 0, 60)).rejects.toBeInstanceOf(RangeError);
    failNextExec();

    await expect(cache.acquireLease(KEY, 'a', 2, 60)).rejects.toThrow(
      'The cache transaction failed',
    );
  });

  it('refuses keys outside the openverify namespace and TTLs or sizes that are not whole and positive', async () => {
    const { redis, commands } = fakeRedis();
    const cache = createKeyValueCache({ redis });

    await expect(cache.get('person@example.test')).rejects.toBeInstanceOf(RangeError);
    await expect(cache.set(KEY, 'value', 0)).rejects.toBeInstanceOf(RangeError);
    await expect(cache.set(KEY, 'value', 1.5)).rejects.toBeInstanceOf(RangeError);
    await expect(cache.pushCapped(KEY, 'a', 0, 900)).rejects.toBeInstanceOf(RangeError);
    await expect(cache.listRange(KEY, 0)).rejects.toBeInstanceOf(RangeError);
    expect(commands).toEqual([]);
  });

  it.each(['reconnecting', 'close', 'end'])(
    'rejects at once while Valkey is %s, so a caller decides what an outage means',
    async (status) => {
      const { redis, commands } = fakeRedis(status);
      const cache = createKeyValueCache({ redis });

      await expect(cache.get(KEY)).rejects.toThrow(`Valkey is unavailable (${status})`);
      await expect(cache.pushCapped(KEY, 'a', 3, 900)).rejects.toThrow('Valkey is unavailable');
      expect(commands).toEqual([]);
    },
  );
});
