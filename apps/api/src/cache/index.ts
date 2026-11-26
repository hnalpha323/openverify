/**
 * C54.3: the key-value cache in Valkey (`KeyValueCache`): the Phase 5 caches (MX answers, KYB
 * registry records, RDAP dates, feeds) and the sandbox SMS sink. It has its own lazy Valkey
 * client, apart from BullMQ's and the rate limiter's, bounded like the limiter's so a Valkey
 * outage costs no latency: while ioredis knows the server is down every call rejects at once,
 * and each caller decides what that means (the OTP limits fail closed, C55.7).
 */
import type { Redis } from 'ioredis';
import type { KeyValueCache } from '../ports.js';
import { createRateLimitRedis } from '../rate-limit/index.js';

/** The part of an ioredis client the cache uses. */
export interface CacheRedis {
  readonly status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  multi(): CacheMulti;
}

export interface CacheMulti {
  zremrangebyscore(key: string, min: number | string, max: number | string): CacheMulti;
  zadd(key: string, score: number, member: string): CacheMulti;
  zcard(key: string): CacheMulti;
  lpush(key: string, value: string): CacheMulti;
  ltrim(key: string, start: number, stop: number): CacheMulti;
  expire(key: string, seconds: number): CacheMulti;
  exec(): Promise<[Error | null, unknown][] | null>;
}

/** A lazy Valkey client for the cache, bounded like the rate limiter's (C12). */
export function createCacheRedis(url: string): Redis {
  return createRateLimitRedis(url);
}

export interface KeyValueCacheOptions {
  redis: CacheRedis;
  /** The time a lease is scored by, in milliseconds; the process clock unless a test gives one. */
  now?: () => number;
}

/** Statuses in which ioredis knows Valkey is unreachable; every call then rejects at once. */
const DOWN = new Set(['reconnecting', 'close', 'end']);

/** Every key lives under this namespace; callers hash anything personal before it. */
export const CACHE_KEY_NAMESPACE = 'openverify:';

/** @throws {RangeError} for a key outside the `openverify:` namespace. */
export function checkKey(key: string): void {
  if (!key.startsWith(CACHE_KEY_NAMESPACE)) {
    throw new RangeError(`Cache keys start with ${CACHE_KEY_NAMESPACE}`);
  }
}

/** @throws {RangeError} unless `value` is a whole number of at least 1. */
export function checkCount(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`The cache ${what} must be a whole number of at least 1`);
  }
}

/** The Valkey cache. */
export function createKeyValueCache(options: KeyValueCacheOptions): KeyValueCache {
  const { redis } = options;
  const now = options.now ?? Date.now;

  /** Runs `call` once the arguments are valid and Valkey is not known to be down. */
  async function guarded<T>(key: string, counts: [number, string][], call: () => Promise<T>) {
    checkKey(key);
    for (const [value, what] of counts) {
      checkCount(value, what);
    }
    if (DOWN.has(redis.status)) {
      throw new Error(`Valkey is unavailable (${redis.status})`);
    }
    return call();
  }

  return {
    get: (key) => guarded(key, [], () => redis.get(key)),
    set: (key, value, ttlSeconds) =>
      guarded(key, [[ttlSeconds, 'TTL']], async () => {
        await redis.set(key, value, 'EX', ttlSeconds);
      }),
    delete: (key) =>
      guarded(key, [], async () => {
        await redis.del(key);
      }),
    pushCapped: (key, value, maxLength, ttlSeconds) =>
      guarded(
        key,
        [
          [maxLength, 'list length'],
          [ttlSeconds, 'TTL'],
        ],
        async () => {
          const results = await redis
            .multi()
            .lpush(key, value)
            .ltrim(key, 0, maxLength - 1)
            .expire(key, ttlSeconds)
            .exec();
          if (results === null || results.some(([error]) => error !== null)) {
            throw new Error('The cache transaction failed');
          }
        },
      ),
    listRange: (key, limit) =>
      guarded(key, [[limit, 'range']], () => redis.lrange(key, 0, limit - 1)),
    // K8-8: a sorted set of lease ids scored by when each lapses. Lapsed ones go, this one is added,
    // and the set is counted in one MULTI, so no two takers both see room that only one has; a taker
    // past the limit takes its own lease back. Concurrent takers can both give up near the limit,
    // which errs on the side of fewer.
    acquireLease: (key, leaseId, limit, ttlSeconds) =>
      guarded(
        key,
        [
          [limit, 'lease limit'],
          [ttlSeconds, 'TTL'],
        ],
        async () => {
          const at = now();
          const results = await redis
            .multi()
            .zremrangebyscore(key, '-inf', at)
            .zadd(key, at + ttlSeconds * 1000, leaseId)
            .zcard(key)
            .expire(key, ttlSeconds)
            .exec();
          if (results === null || results.some(([error]) => error !== null)) {
            throw new Error('The cache transaction failed');
          }
          if (Number(results[2]?.[1]) <= limit) {
            return true;
          }
          await redis.zrem(key, leaseId);
          return false;
        },
      ),
    releaseLease: (key, leaseId) =>
      guarded(key, [], async () => {
        await redis.zrem(key, leaseId);
      }),
  };
}
