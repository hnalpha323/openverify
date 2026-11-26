import { assertBlindIndexKey, normalizeEmail } from '@openverify/db';
import { createWorkerLogger } from '../jobs/logger.js';
import { systemClock, type Clock } from '../ports.js';
import { closeRateLimitRedis, createRateLimitRedis } from '../rate-limit/index.js';
import {
  createValkeyLoginRateLimiter,
  type LoginLimitLogger,
} from './valkey-login-rate-limiter.js';

/** At most `max` attempts per key in each fixed window of `windowMs`. */
export interface RateLimitRule {
  max: number;
  windowMs: number;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * C4 login limits. Every attempt counts, successful or not, so the limits cannot be probed.
 * The per-address limit is the looser one because operators can share an address (an office
 * NAT, or the dashboard server itself when no trusted proxy forwards the client address).
 */
export const DEFAULT_LOGIN_RATE_LIMITS = Object.freeze({
  perIp: Object.freeze({ max: 50, windowMs: FIFTEEN_MINUTES }),
  perEmail: Object.freeze({ max: 10, windowMs: FIFTEEN_MINUTES }),
});

/** Keys the limiter keeps before it evicts the oldest. Each attempt uses two. */
const DEFAULT_MAX_KEYS = 100_000;

export interface LoginRateLimitOptions {
  perIp?: RateLimitRule;
  perEmail?: RateLimitRule;
  clock?: Clock;
  /** Upper bound on tracked keys, so a flood of addresses cannot exhaust memory. */
  maxKeys?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the blocking window ends; 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Login attempt limits per client address and per email (C4). The interface is async so the
 * counters could move to Valkey and be shared across API instances: since Workflow 11B (C246) the
 * API runs `createSharedLoginRateLimiter`, and the in-process `createLoginRateLimiter` serves
 * tests and an operator auth built without one.
 */
export interface LoginRateLimiter {
  /**
   * Records one attempt. When either key is over its limit the attempt is refused and
   * counted against neither key.
   */
  attempt(input: { ip: string; email: string }): Promise<RateLimitDecision>;
  /** Forgets the email's attempts, after a successful login. */
  reset(input: { email: string }): Promise<void>;
  /** Number of keys currently tracked. */
  size(): number;
}

interface Window {
  count: number;
  endsAt: number;
}

function checkRule(rule: RateLimitRule, label: string): RateLimitRule {
  if (!Number.isSafeInteger(rule.max) || rule.max < 1) {
    throw new RangeError(`${label}.max must be a positive integer`);
  }
  if (!Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) {
    throw new RangeError(`${label}.windowMs must be a positive integer`);
  }
  return rule;
}

/** The in-memory fixed-window limiter for one API process. */
export function createLoginRateLimiter(options: LoginRateLimitOptions = {}): LoginRateLimiter {
  const perIp = checkRule(options.perIp ?? DEFAULT_LOGIN_RATE_LIMITS.perIp, 'perIp');
  const perEmail = checkRule(options.perEmail ?? DEFAULT_LOGIN_RATE_LIMITS.perEmail, 'perEmail');
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 2) {
    throw new RangeError('maxKeys must be an integer of at least 2');
  }
  const clock = options.clock ?? systemClock;
  const windows = new Map<string, Window>();

  const live = (key: string, now: number): Window | undefined => {
    const window = windows.get(key);
    return window !== undefined && window.endsAt > now ? window : undefined;
  };

  const makeRoom = (now: number): void => {
    if (windows.size < maxKeys) {
      return;
    }
    for (const [key, window] of windows) {
      if (window.endsAt <= now) {
        windows.delete(key);
      }
    }
    // Map iteration follows insertion order, and a new window is re-inserted, so the first
    // keys are the ones whose windows started longest ago.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) {
        break;
      }
      windows.delete(key);
    }
  };

  const count = (key: string, rule: RateLimitRule, now: number): void => {
    const window = live(key, now);
    if (window !== undefined) {
      window.count += 1;
      return;
    }
    windows.delete(key);
    makeRoom(now);
    windows.set(key, { count: 1, endsAt: now + rule.windowMs });
  };

  const blockedFor = (key: string, rule: RateLimitRule, now: number): number => {
    const window = live(key, now);
    return window !== undefined && window.count >= rule.max ? window.endsAt - now : 0;
  };

  return {
    attempt: ({ ip, email }) => {
      const now = clock.now().getTime();
      const ipKey = `ip:${ip}`;
      const emailKey = `email:${normalizeEmail(email)}`;
      const waitMs = Math.max(blockedFor(ipKey, perIp, now), blockedFor(emailKey, perEmail, now));
      if (waitMs > 0) {
        return Promise.resolve({ allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) });
      }
      count(ipKey, perIp, now);
      count(emailKey, perEmail, now);
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    },
    reset: ({ email }) => {
      windows.delete(`email:${normalizeEmail(email)}`);
      return Promise.resolve();
    },
    size: () => windows.size,
  };
}

/** What the container hands the shared login limiter (C246.1). */
export interface SharedLoginRateLimiterOptions {
  /** `REDIS_URL`: the limiter's own lazy Valkey client, as the C12 limiter has. */
  readonly redisUrl: string;
  /** `OPENVERIFY_BLIND_INDEX_KEY`, from which the per-email key's HMAC subkey is derived. */
  readonly blindIndexKey: Uint8Array;
  readonly clock: Clock;
  /**
   * C246.2 (auth-sessions): where the warn line and `rate_limiter_store_unavailable` go when the
   * store does not answer; by default a logger of its own named `openverify-api`.
   */
  readonly logger?: LoginLimitLogger;
}

/** A login limiter and the release of what it holds. */
export interface SharedLoginRateLimiter {
  readonly limiter: LoginRateLimiter;
  close(): Promise<void>;
}

/**
 * C246.1 (decision 10): the login limiter every API instance shares, in Valkey, failing closed for
 * login only (503 `login_unavailable`, C246.2): `createValkeyLoginRateLimiter` over its own lazy
 * client of `redisUrl` (connected on first use, every call bounded as the C12 limiter's), closed
 * with the container. The key names are HMACs under the subkey derived from `blindIndexKey`.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function createSharedLoginRateLimiter(
  options: SharedLoginRateLimiterOptions,
): SharedLoginRateLimiter {
  // Before the client exists, so a bad key leaves nothing open.
  assertBlindIndexKey(options.blindIndexKey);
  const redis = createRateLimitRedis(options.redisUrl);
  const limiter = createValkeyLoginRateLimiter({
    redis,
    blindIndexKey: options.blindIndexKey,
    logger: options.logger ?? createWorkerLogger({ name: 'openverify-api' }),
  });
  return { limiter, close: () => closeRateLimitRedis(redis) };
}
