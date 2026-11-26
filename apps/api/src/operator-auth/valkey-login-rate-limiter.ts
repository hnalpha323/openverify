/**
 * C246 (Phase 11, Workflow 11B, auth-sessions; decision 10, review F19 and P32): the C4 login
 * limiter in Valkey, shared by every API instance, behind the unchanged `LoginRateLimiter`
 * interface. The contract (the windows, the key names, the Lua script's arguments and answer) is
 * `packages/contracts/src/console-auth.ts`.
 *
 * - **Keys** (review P32): each of the two key names holds an HMAC-SHA-256 under the login-limit
 *   subkey, so no address or email reaches a key name, an AOF file or `SCAN` output; the email is
 *   normalised and not scoped to an organisation (C246.3), as the sign-in checks every account with
 *   that email.
 * - **One script** checks and counts both keys atomically: a refused attempt is counted against
 *   neither key (C4's rule), and the answer is how long the later blocking window still runs.
 * - **Fails closed** (C246.2, ours): when the store does not answer, every use (the sign-in and the
 *   step-up) throws 503 `login_unavailable` with `Retry-After`, after one warn line and the metric
 *   `rate_limiter_store_unavailable`; the API's other limits keep failing open (H18).
 * - **Honesty** (C246.5): the limits slow online guessing; a slow attempt spread over many addresses
 *   and accounts stays under them, which MFA must cover.
 */
import { createHmac } from 'node:crypto';
import {
  LOGIN_LIMIT_KEY_LABEL,
  LOGIN_LIMITS,
  LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS,
  loginLimitKeys,
} from '@openverify/contracts';
import { assertBlindIndexKey, normalizeEmail } from '@openverify/db';
import { AppError } from '../errors.js';
import { metrics } from '../metrics-registry.js';
import { RATE_LIMITER_STORE_UNAVAILABLE_METRIC } from '../rate-limit/index.js';
import type { LoginRateLimiter } from './login-rate-limiter.js';

/**
 * C246.2: 503 `login_unavailable` with `Retry-After`, when the login limiter's store does not
 * answer: sign-in and the step-up fail closed rather than let guesses through uncounted.
 */
export class LoginUnavailableError extends AppError {
  override name = 'LoginUnavailableError';

  constructor() {
    super({
      status: 503,
      code: 'login_unavailable',
      detail: 'Signing in is unavailable for the moment. Try again shortly.',
      headers: { 'retry-after': String(LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS) },
    });
  }
}

/** The name the script is registered under on the client (`defineCommand`). */
export const LOGIN_LIMIT_COMMAND = 'openverifyLoginLimit';

/**
 * C246.1's Lua script. KEYS[1] the address key, KEYS[2] the email key; ARGV[1] the per-address
 * limit, ARGV[2] the per-email limit, ARGV[3] the window in milliseconds. Answers 0 after counting
 * both keys (starting a key's window when its count becomes 1), or, without counting either, the
 * milliseconds until the later blocking window ends. A count found without an expiry (never
 * written so by this script) gets the window again, so no key outlives it.
 */
export const LOGIN_LIMIT_SCRIPT = `
local window = tonumber(ARGV[3])
local function blocking(key, limit)
  local count = tonumber(redis.call('GET', key) or 0) or 0
  if count < limit then
    return 0
  end
  local ttl = redis.call('PTTL', key)
  if ttl < 0 then
    redis.call('PEXPIRE', key, window)
    ttl = window
  end
  return ttl
end
local function count(key)
  if redis.call('INCR', key) == 1 then
    redis.call('PEXPIRE', key, window)
  end
end
local wait = math.max(blocking(KEYS[1], tonumber(ARGV[1])), blocking(KEYS[2], tonumber(ARGV[2])))
if wait > 0 then
  return wait
end
count(KEYS[1])
count(KEYS[2])
return 0
`;

/** C250.7: the metric of a rate-limit store that did not answer (no labels). */
export { RATE_LIMITER_STORE_UNAVAILABLE_METRIC };

/** Statuses in which ioredis knows Valkey is unreachable; the limiter then refuses at once. */
const DOWN = new Set(['reconnecting', 'close', 'end']);

/** The part of an ioredis client the limiter uses. */
export interface LoginLimitRedis {
  /** ioredis connection status: `wait`, `connecting`, `connect`, `ready`, `reconnecting`... */
  readonly status: string;
  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
  del(key: string): Promise<unknown>;
}

/** What `defineCommand` adds to the client. */
interface LoginLimitClient {
  [LOGIN_LIMIT_COMMAND](
    addressKey: string,
    emailKey: string,
    perAddress: string,
    perEmail: string,
    windowMs: string,
  ): Promise<unknown>;
}

/** The part of a pino logger the limiter writes its warn line and metric with. */
export interface LoginLimitLogger {
  warn(object: Record<string, unknown>, message: string): void;
  info(object: Record<string, unknown>, message: string): void;
}

export interface ValkeyLoginRateLimiterOptions {
  redis: LoginLimitRedis;
  /** `OPENVERIFY_BLIND_INDEX_KEY` (32 bytes): the login-limit subkey is derived from it. */
  blindIndexKey: Uint8Array;
  logger: LoginLimitLogger;
  /** C4's windows; tests narrow them. Defaults to `LOGIN_LIMITS`. */
  limits?: { perAddress: number; perEmail: number; windowMs: number };
}

/** The HMACs the two key names are made of (lowercase hex). */
export interface LoginLimitHmacs {
  addressHmac: string;
  emailHmac: string;
}

/**
 * C246.1: the login-limit subkey, HMAC-SHA-256(key, `LOGIN_LIMIT_KEY_LABEL`), derived as the blind
 * index derives its environment subkeys, so the limiter needs no secret of its own.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes (naming the variable, never the key).
 */
export function loginLimitSubkey(blindIndexKey: Uint8Array): Uint8Array {
  assertBlindIndexKey(blindIndexKey);
  return new Uint8Array(
    createHmac('sha256', blindIndexKey).update(LOGIN_LIMIT_KEY_LABEL, 'utf8').digest(),
  );
}

const hmacHex = (key: Uint8Array, value: string): string =>
  createHmac('sha256', key).update(value, 'utf8').digest('hex');

/** C246.1: the HMACs of `ip:<address>` and `email:<normalised email>` under the subkey. */
export function loginLimitHmacs(
  subkey: Uint8Array,
  input: { ip: string; email: string },
): LoginLimitHmacs {
  return {
    addressHmac: hmacHex(subkey, `ip:${input.ip}`),
    emailHmac: hmacHex(subkey, `email:${normalizeEmail(input.email)}`),
  };
}

function checkLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

/** The script's answer: the wait in milliseconds, or a rejection for anything else. */
function parseWait(reply: unknown): number {
  if (typeof reply === 'number' && Number.isSafeInteger(reply) && reply >= 0) {
    return reply;
  }
  throw new Error('The login limit script returned an unexpected reply');
}

/**
 * C246.1 and C246.2: the login limiter in Valkey, failing closed. `attempt` throws
 * {@link LoginUnavailableError} when the store does not answer; `reset` only logs, because the
 * session it follows has opened; `size` is 0 (no key is tracked in process).
 */
export function createValkeyLoginRateLimiter(
  options: ValkeyLoginRateLimiterOptions,
): LoginRateLimiter {
  const { redis, logger } = options;
  const perAddress = checkLimit(
    options.limits?.perAddress ?? LOGIN_LIMITS.perAddress,
    'perAddress',
  );
  const perEmail = checkLimit(options.limits?.perEmail ?? LOGIN_LIMITS.perEmail, 'perEmail');
  const windowMs = checkLimit(
    options.limits?.windowMs ?? LOGIN_LIMITS.windowSeconds * 1000,
    'windowMs',
  );
  const subkey = loginLimitSubkey(options.blindIndexKey);
  redis.defineCommand(LOGIN_LIMIT_COMMAND, { numberOfKeys: 2, lua: LOGIN_LIMIT_SCRIPT });
  const client = redis as LoginLimitRedis & LoginLimitClient;

  /** One warn line and the metric; never the address, the email, a key name or the error text. */
  const reportUnavailable = (operation: 'attempt' | 'reset'): void => {
    logger.warn(
      { limiter: 'login', operation },
      operation === 'attempt'
        ? 'login limiter store unavailable; failing closed with 503 login_unavailable'
        : 'login limiter store unavailable; the email window was not reset',
    );
    metrics.emit(logger, RATE_LIMITER_STORE_UNAVAILABLE_METRIC, 1);
  };

  return {
    async attempt(input) {
      const [addressKey, emailKey] = loginLimitKeys(loginLimitHmacs(subkey, input));
      let waitMs: number;
      try {
        if (DOWN.has(redis.status)) {
          throw new Error('Valkey is unavailable');
        }
        waitMs = parseWait(
          await client[LOGIN_LIMIT_COMMAND](
            addressKey,
            emailKey,
            String(perAddress),
            String(perEmail),
            String(windowMs),
          ),
        );
      } catch {
        reportUnavailable('attempt');
        throw new LoginUnavailableError();
      }
      return waitMs === 0
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
    },
    async reset({ email }) {
      const [, emailKey] = loginLimitKeys(loginLimitHmacs(subkey, { ip: '', email }));
      try {
        if (DOWN.has(redis.status)) {
          throw new Error('Valkey is unavailable');
        }
        await redis.del(emailKey);
      } catch {
        reportUnavailable('reset');
      }
    },
    size: () => 0,
  };
}
