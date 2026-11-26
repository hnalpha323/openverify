/**
 * C61.2, C61.4: the request pacing of the KYB clients. GLEIF (60 a minute), Companies House (600
 * per 5 minutes), SEC EDGAR (10 a second, organisation-wide) and each RDAP host (1 a second, ours)
 * ask for limits shared by every worker of an install. A rule allows one request per interval,
 * install-wide: GCRA with no burst.
 *
 * - With the worker's GCRA limiter bound (Workflow 5C review K4), each turn is the GCRA script's
 *   answer (`pacing:<rule>`, a limit of 1 per interval): one atomic call in Valkey, on Valkey's
 *   clock. A refused request waits for the turn the script names.
 * - Without it (unit tests, the API process), each interval is a slot in Valkey (`KeyValueCache`):
 *   a request appends a token to its slot's list (`pushCapped`, one atomic transaction) and holds
 *   the slot when its token is the first; otherwise it waits for the next slot.
 *
 * Either way a request waits at most `maxWaitMs` and then fails with a retryable `ProviderError`
 * (`rate_limited`), so the job retries later. Without a store, or while Valkey is down, the pacing
 * falls back to this process alone. Keys hold the rule's name and a SHA-256 of its key, never a
 * credential or a host the user typed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import {
  systemClock,
  type Clock,
  type KeyValueCache,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitRule,
} from '../../ports.js';
import { ProviderError } from '../errors.js';

/** One limit: at most one request per `intervalMs` for each key. */
export interface PacingRule {
  /** Names the limit in its Valkey keys, such as `gleif`. */
  name: string;
  intervalMs: number;
}

export interface ProviderPacer {
  /**
   * Waits for this request's turn under `rule` for `key`.
   * @throws {ProviderError} `rate_limited` (retryable) when the turn is further than the wait allows.
   */
  acquire(rule: PacingRule, key: string): Promise<void>;
}

export interface ProviderPacerOptions {
  /**
   * The worker's GCRA limiter (Workflow 5C review K4). When bound, each turn is the GCRA script's
   * answer; the cache slots serve only without it.
   */
  rateLimiter?: RateLimiter | undefined;
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
  /** Waits `ms` milliseconds; tests advance their clock instead. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** The longest a request waits for its turn; defaults to {@link DEFAULT_PACING_MAX_WAIT_MS}. */
  maxWaitMs?: number | undefined;
}

/** How long a request may wait for its turn before the job is retried instead. */
export const DEFAULT_PACING_MAX_WAIT_MS = 10_000;

/** Tokens a slot's list keeps: enough to see who came first under any realistic burst. */
const SLOT_LIST_LENGTH = 16;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const rateLimited = (rule: PacingRule) =>
  new ProviderError(`${rule.name}: no request turn within the wait allowed`, {
    retryable: true,
    code: 'rate_limited',
  });

/** The GCRA rule of `rule`: one request per interval, no burst (Workflow 5C review K4). */
const gcraRuleOf = (rule: PacingRule): RateLimitRule => ({
  name: `pacing:${rule.name}`,
  limit: 1,
  windowSeconds: rule.intervalMs / 1000,
});

/** The pacer of one process; with a limiter or a cache, of every process that shares it. */
export function createProviderPacer(options: ProviderPacerOptions = {}): ProviderPacer {
  const clock = options.clock ?? systemClock;
  const sleep = options.sleep ?? realSleep;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_PACING_MAX_WAIT_MS;
  const { cache, rateLimiter } = options;
  /** When each rule and key is next free in this process (the fallback). */
  const nextFree = new Map<string, number>();

  /** Holds the slot for this process alone, waiting for it when it is ahead. */
  async function acquireLocally(rule: PacingRule, digest: string, deadline: number) {
    const now = clock.now().getTime();
    const local = `${rule.name}:${digest}`;
    const start = Math.max(now, nextFree.get(local) ?? now);
    if (start > deadline) {
      throw rateLimited(rule);
    }
    nextFree.set(local, start + rule.intervalMs);
    if (start > now) {
      await sleep(start - now);
    }
  }

  /** Whether this request is the first of its slot, or `null` when the cache failed. */
  async function holdsSlot(store: KeyValueCache, rule: PacingRule, digest: string, slot: number) {
    const key = `${CACHE_KEY_NAMESPACE}pacing:${rule.name}:${digest}:${String(slot)}`;
    const token = randomUUID();
    const ttlSeconds = Math.max(1, Math.ceil((2 * rule.intervalMs) / 1000));
    try {
      await store.pushCapped(key, token, SLOT_LIST_LENGTH, ttlSeconds);
      const tokens = await store.listRange(key, SLOT_LIST_LENGTH);
      // Newest first: the first request of the slot is last, unless a burst cut the list.
      return tokens.length < SLOT_LIST_LENGTH && tokens.at(-1) === token;
    } catch {
      return null;
    }
  }

  /** Waits for the GCRA script's turn; `false` when the limiter failed (Valkey down). */
  async function acquireByLimiter(
    limiter: RateLimiter,
    rule: PacingRule,
    key: string,
    deadline: number,
  ): Promise<boolean> {
    for (;;) {
      let decision: RateLimitDecision;
      try {
        // The limiter keys its store by the rule's name and a SHA-256 of `key`.
        decision = await limiter.consume(key, gcraRuleOf(rule));
      } catch {
        return false;
      }
      if (decision.allowed) {
        return true;
      }
      const now = clock.now().getTime();
      const turn = Math.max(now, decision.resetAt.getTime());
      if (turn > deadline) {
        throw rateLimited(rule);
      }
      await sleep(turn - now);
    }
  }

  return {
    async acquire(rule, key) {
      const digest = createHash('sha256').update(key).digest('hex');
      const deadline = clock.now().getTime() + maxWaitMs;
      if (rateLimiter !== undefined) {
        if (!(await acquireByLimiter(rateLimiter, rule, key, deadline))) {
          // Valkey is down: this process paces alone rather than fail the check.
          await acquireLocally(rule, digest, deadline);
        }
        return;
      }
      if (cache === undefined) {
        await acquireLocally(rule, digest, deadline);
        return;
      }
      for (;;) {
        const now = clock.now().getTime();
        const slot = Math.floor(now / rule.intervalMs);
        const held = await holdsSlot(cache, rule, digest, slot);
        if (held === null) {
          // Valkey is down: this process paces alone rather than fail the check.
          await acquireLocally(rule, digest, deadline);
          return;
        }
        if (held) {
          return;
        }
        const next = (slot + 1) * rule.intervalMs;
        if (next > deadline) {
          throw rateLimited(rule);
        }
        await sleep(next - now);
      }
    },
  };
}
