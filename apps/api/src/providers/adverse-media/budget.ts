/**
 * C81.2 (V09, P09): the GDELT budget. GDELT asks for one request every 5 s, so the install keeps
 * one GCRA of one request per 5 s in Valkey (`pacing:gdelt`, on Valkey's clock), shared among the
 * environments that asked for a request in the last 60 s: each environment's share is one request
 * per 5 s × N, N the number of those environments. One environment waiting alone gets the whole
 * budget, two get half each, and none can take another's share.
 *
 * Per request:
 * 1. the environment is recorded in a capped list of askers (`openverify:gdelt:askers`, entries
 *    `<environment id> <epoch ms>`, kept 60 s), and N is the number of distinct environments in it
 *    within the last 60 s, this one included;
 * 2. the environment's share is free when its next-free time (`openverify:gdelt:share:<id>`) has
 *    passed. It is read, not consumed: an environment over its share never burns an install
 *    request another environment could use;
 * 3. only then is the install-wide GCRA consumed;
 * 4. on a grant the share's next-free time moves 5 s × N ahead.
 *
 * A refusal names when to ask again (the share's next-free time, or the install's retry time) plus
 * up to a second of jitter, so waiting runs do not all ask at once. While Valkey is down nothing is
 * granted: sending without the shared budget could exceed GDELT's ask, so the run waits. Valkey
 * holds environment ids and times only, never a name or an article. Without a limiter or a cache
 * (a process without Valkey) the same rules hold within this process.
 */
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import {
  systemClock,
  type Clock,
  type KeyValueCache,
  type RateLimiter,
  type RateLimitRule,
} from '../../ports.js';

/** C81.2: one request per 5 s install-wide, shared among the environments of the last 60 s. */
export const GDELT_BUDGET = Object.freeze({
  intervalMs: 5_000,
  activeWindowMs: 60_000,
  /** Askers the list keeps: far more than ask within a minute at one request per 5 s. */
  maxAskers: 512,
  maxJitterMs: 1_000,
});

export type GdeltBudgetDecision = { granted: true } | { granted: false; retryAt: Date };

export interface GdeltBudget {
  /** Takes one request for `environmentId`, or says when to ask again. */
  take(environmentId: string): Promise<GdeltBudgetDecision>;
}

export interface GdeltBudgetOptions {
  rateLimiter?: RateLimiter | undefined;
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
  /** In [0, 1): the jitter's draw; tests fix it. */
  random?: (() => number) | undefined;
  /** Tests shorten the interval; production keeps {@link GDELT_BUDGET}'s. */
  intervalMs?: number | undefined;
}

const ASKERS_KEY = `${CACHE_KEY_NAMESPACE}gdelt:askers`;
const shareKey = (environmentId: string) => `${CACHE_KEY_NAMESPACE}gdelt:share:${environmentId}`;

/** The part of the cache the budget uses, kept in this process when there is no Valkey. */
type BudgetStore = Pick<KeyValueCache, 'get' | 'set' | 'pushCapped' | 'listRange'>;

function processStore(clock: Clock): BudgetStore {
  const values = new Map<string, { value: string | string[]; until: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    return entry !== undefined && entry.until > clock.now().getTime() ? entry.value : undefined;
  };
  const until = (ttlSeconds: number) => clock.now().getTime() + ttlSeconds * 1000;
  return {
    get: (key) => {
      const value = live(key);
      return Promise.resolve(typeof value === 'string' ? value : null);
    },
    set: (key, value, ttlSeconds) => {
      values.set(key, { value, until: until(ttlSeconds) });
      return Promise.resolve();
    },
    pushCapped: (key, value, maxLength, ttlSeconds) => {
      const list = live(key);
      values.set(key, {
        value: [value, ...(Array.isArray(list) ? list : [])].slice(0, maxLength),
        until: until(ttlSeconds),
      });
      return Promise.resolve();
    },
    listRange: (key, limit) => {
      const list = live(key);
      return Promise.resolve(Array.isArray(list) ? list.slice(0, limit) : []);
    },
  };
}

/** C81.2: the budget (see the file header). */
export function createGdeltBudget(options: GdeltBudgetOptions = {}): GdeltBudget {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const intervalMs = options.intervalMs ?? GDELT_BUDGET.intervalMs;
  const store = options.cache ?? processStore(clock);
  const rule: RateLimitRule = { name: 'pacing:gdelt', limit: 1, windowSeconds: intervalMs / 1000 };
  /** This process's install GCRA, used only without a limiter. */
  let localNext = 0;

  async function installRetryMs(now: number): Promise<number> {
    if (options.rateLimiter !== undefined) {
      const decision = await options.rateLimiter.consume('install', rule);
      return decision.allowed ? 0 : decision.retryAfterSeconds * 1000;
    }
    if (localNext > now) {
      return localNext - now;
    }
    localNext = now + intervalMs;
    return 0;
  }

  const refused = (atMs: number): GdeltBudgetDecision => ({
    granted: false,
    retryAt: new Date(atMs + Math.floor(random() * GDELT_BUDGET.maxJitterMs)),
  });

  return {
    async take(environmentId) {
      const now = clock.now().getTime();
      try {
        await store.pushCapped(
          ASKERS_KEY,
          `${environmentId} ${String(now)}`,
          GDELT_BUDGET.maxAskers,
          Math.ceil(GDELT_BUDGET.activeWindowMs / 1000),
        );
        const active = new Set([environmentId]);
        for (const entry of await store.listRange(ASKERS_KEY, GDELT_BUDGET.maxAskers)) {
          const [id, at] = entry.split(' ');
          if (id !== undefined && now - Number(at) < GDELT_BUDGET.activeWindowMs) {
            active.add(id);
          }
        }
        const nextFree = Number((await store.get(shareKey(environmentId))) ?? 0);
        if (nextFree > now) {
          return refused(nextFree);
        }
        const retryMs = await installRetryMs(now);
        if (retryMs > 0) {
          return refused(now + retryMs);
        }
        const shareMs = intervalMs * active.size;
        await store.set(
          shareKey(environmentId),
          String(now + shareMs),
          Math.ceil(shareMs / 1000) + 1,
        );
        return { granted: true };
      } catch {
        // Valkey is down: no request without the shared budget.
        return refused(now + intervalMs);
      }
    },
  };
}
