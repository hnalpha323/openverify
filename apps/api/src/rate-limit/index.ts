/**
 * C12 rate limiting: GCRA (the generic cell rate algorithm) in Valkey, applied atomically by
 * one Lua script, so every API instance sharing the Valkey enforces the same limit.
 *
 * A rule of `limit` requests per `windowSeconds` emits one request every
 * `interval = window / limit` ms and tolerates a burst of the whole limit. Valkey keeps one
 * value per key, the theoretical arrival time (TAT) of the next request: a request at `now` is
 * allowed when `max(TAT, now) + interval - window <= now`, and then moves the TAT on by
 * `interval`. The quota is whole again at the TAT, which is what `resetAt` reports. Time comes
 * from Valkey (`TIME`), so instances with skewed clocks still agree.
 */
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { createWorkerLogger } from '../jobs/logger.js';
import { metrics } from '../metrics-registry.js';
import {
  systemClock,
  type Clock,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitRule,
} from '../ports.js';

/** C246.2, C250.7 (Workflow 11B): the metric of a rate-limit store that did not answer (no labels). */
export const RATE_LIMITER_STORE_UNAVAILABLE_METRIC = 'rate_limiter_store_unavailable';

/** The name the script is registered under on the client (`defineCommand`). */
export const GCRA_COMMAND = 'openverifyGcra';

/**
 * KEYS[1]: the limit's key. ARGV[1]: the emission interval in ms (may be fractional).
 * ARGV[2]: the limit. Returns `{ allowed (0 or 1), remaining, reset ms, retry-after ms }`.
 * The TAT is stored in ms with three decimals, so fractional intervals do not drift, and
 * expires when it is in the past, which is when the quota is whole again anyway.
 */
export const GCRA_SCRIPT = `
local interval = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = interval * limit
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local tat = tonumber(redis.call('GET', KEYS[1]) or 0) or 0
if tat < now then
  tat = now
end
local next_tat = tat + interval
local allow_at = next_tat - window
if allow_at > now then
  return { 0, 0, math.ceil(tat - now), math.ceil(allow_at - now) }
end
local ttl = math.max(1, math.ceil(next_tat - now))
redis.call('SET', KEYS[1], string.format('%.3f', next_tat), 'PX', ttl)
return { 1, math.floor((now - allow_at) / interval), ttl, 0 }
`;

/** C240.3 (KP11-11): the name the read-only script is registered under. */
export const GCRA_PEEK_COMMAND = 'openverifyGcraPeek';

/**
 * C240.3, amendment 22 (KP11-11; integration-11b): the GCRA state of KEYS[1] without counting a
 * request (no write). ARGV as {@link GCRA_SCRIPT}. Returns `{ allowed now (0 or 1), remaining now,
 * reset ms (until the quota is whole), retry-after ms }`.
 */
export const GCRA_PEEK_SCRIPT = `
local interval = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = interval * limit
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local tat = tonumber(redis.call('GET', KEYS[1]) or 0) or 0
if tat < now then
  tat = now
end
local remaining = math.floor((now - (tat - window)) / interval)
if remaining > limit then
  remaining = limit
end
if remaining < 1 then
  return { 0, 0, math.ceil(tat - now), math.max(1, math.ceil(tat + interval - window - now)) }
end
return { 1, remaining, math.ceil(tat - now), 0 }
`;

/** The part of an ioredis client the limiter uses. */
export interface RateLimitRedis {
  /** ioredis connection status: `wait`, `connecting`, `connect`, `ready`, `reconnecting`... */
  readonly status: string;
  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
}

/** What `defineCommand` adds to the client. */
interface GcraClient {
  [GCRA_COMMAND](key: string, intervalMs: string, limit: string): Promise<unknown>;
  [GCRA_PEEK_COMMAND](key: string, intervalMs: string, limit: string): Promise<unknown>;
}

/** Statuses in which ioredis knows Valkey is unreachable; requests then fail open at once. */
const DOWN = new Set(['reconnecting', 'close', 'end']);

const KEY_PREFIX = 'openverify:rate-limit:';

export interface RateLimiterOptions {
  /** A client from {@link createRateLimitRedis}, shared by every rule. */
  redis: RateLimitRedis;
  /** Turns the script's relative reset time into `resetAt`. */
  clock?: Clock;
  /**
   * C246.2 (Workflow 11B, auth-sessions): where a store that does not answer is reported (a warn
   * line and `rate_limiter_store_unavailable`); by default a logger of its own named `openverify-api`.
   */
  logger?: RateLimitStoreLogger;
}

/** The part of a pino logger the limiter reports an unreachable store with. */
export interface RateLimitStoreLogger {
  warn(object: Record<string, unknown>, message: string): void;
  info(object: Record<string, unknown>, message: string): void;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The script's reply, or a rejection for anything else. */
function parseReply(
  reply: unknown,
): [allowed: boolean, remaining: number, resetMs: number, retryMs: number] {
  if (Array.isArray(reply) && reply.length === 4 && reply.every(isCount)) {
    const [allowed, remaining, resetMs, retryMs] = reply as [number, number, number, number];
    if (allowed <= 1) {
      return [allowed === 1, remaining, resetMs, retryMs];
    }
  }
  throw new Error('The rate limit script returned an unexpected reply');
}

function checkRule(rule: RateLimitRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1 || !(rule.windowSeconds > 0)) {
    throw new RangeError(`Invalid rate limit rule for ${rule.name}`);
  }
}

/**
 * The limiter's Valkey key: the policy plus a SHA-256 of the caller's key, so client addresses
 * and credentials are never stored in clear and keys stay short.
 */
function storeKey(key: string, rule: RateLimitRule): string {
  return `${KEY_PREFIX}${rule.name}:${createHash('sha256').update(key).digest('base64url')}`;
}

/**
 * The C12 limiter. `consume` rejects when Valkey is unavailable or answers unexpectedly;
 * callers then fail open (see `plugins/rate-limit.ts`).
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { redis } = options;
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? createWorkerLogger({ name: 'openverify-api' });
  redis.defineCommand(GCRA_COMMAND, { numberOfKeys: 1, lua: GCRA_SCRIPT });
  redis.defineCommand(GCRA_PEEK_COMMAND, { numberOfKeys: 1, lua: GCRA_PEEK_SCRIPT });
  const client = redis as RateLimitRedis & GcraClient;

  /** C246.2: one warn line and the metric; the caller fails open or closed (never the error text). */
  const report = (rule: RateLimitRule): void => {
    logger.warn({ policy: rule.name }, 'rate limit store unavailable');
    metrics.emit(logger, RATE_LIMITER_STORE_UNAVAILABLE_METRIC, 1);
  };

  /** Runs one script; a store that does not answer is reported and rethrown. */
  const run = async (
    command: typeof GCRA_COMMAND | typeof GCRA_PEEK_COMMAND,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitDecision> => {
    checkRule(rule);
    let reply: [allowed: boolean, remaining: number, resetMs: number, retryMs: number];
    try {
      if (DOWN.has(redis.status)) {
        throw new Error(`Valkey is unavailable (${redis.status})`);
      }
      const interval = (rule.windowSeconds * 1000) / rule.limit;
      reply = parseReply(
        await client[command](storeKey(key, rule), String(interval), String(rule.limit)),
      );
    } catch (error) {
      report(rule);
      throw error;
    }
    const [allowed, remaining, resetMs, retryMs] = reply;
    return {
      allowed,
      limit: rule.limit,
      remaining,
      resetAt: new Date(clock.now().getTime() + resetMs),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
    };
  };

  return {
    consume: (key, rule) => run(GCRA_COMMAND, key, rule),
    // C240.3 (KP11-11): the same bucket, read without counting a request.
    peek: (key, rule) => run(GCRA_PEEK_COMMAND, key, rule),
  };
}

/**
 * A Valkey client for the limiter, from a `redis://` URL. It connects on first use and bounds
 * every call: a request waits at most `commandTimeout` for Valkey, and while ioredis knows the
 * server is down the limiter does not wait at all, so an outage costs no latency (C12 fails
 * open). Connection errors are not logged here: every refused `consume` is logged by the
 * rate-limit hook instead.
 */
export function createRateLimitRedis(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 2_000,
  });
  redis.on('error', () => {
    // Reported by the rate-limit hook on each request that fails open.
  });
  return redis;
}

/** The part of the client {@link closeRateLimitRedis} uses. */
export interface ClosableRedis {
  readonly status: string;
  quit(): Promise<unknown>;
  disconnect(): void;
}

/**
 * Closes the client: a connected one gracefully (`QUIT`), anything else at once, so closing
 * never opens a connection or waits for a server that is down.
 */
export async function closeRateLimitRedis(redis: ClosableRedis): Promise<void> {
  if (redis.status === 'ready') {
    try {
      await redis.quit();
      return;
    } catch {
      // Fall through to a hard disconnect.
    }
  }
  redis.disconnect();
}
