/**
 * C245 and C246 (Phase 11, Workflow 11B Stage 1a, common): the console session's limits and the
 * login limiter's contract, frozen for `foundation-11b` (the variables) and `auth-sessions` (the
 * session policy and the Valkey limiter).
 *
 * **Session limits (C245.1, decision 9).** A console session ends after `idleSeconds` without an
 * authenticated request (`OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS`) and after `absoluteSeconds` in
 * all (`OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS`, the former `USER_SESSION_TOKEN_TTL_SECONDS`,
 * which keeps its value as the default). Both are provisional: 30 minutes is a common console
 * default for a tool that shows personal data, and 12 hours a working day with overtime. A request
 * moves `last_seen_at` at most once every `SESSION_LAST_SEEN_WRITE_SECONDS`, so a busy page does not
 * write per request; a route marked `activity: false` (a background poll) is checked but moves
 * nothing. The answer past a limit is 401 `session_expired` with `reason` (`problem.ts`).
 *
 * **The login limiter (C246.1, review F19).** C4's windows move to Valkey as their own limiter,
 * outside `RATE_LIMIT_POLICIES` and never listed by `GET /api/v1/rate-limits`: two fixed windows of
 * `LOGIN_LIMITS.windowSeconds`, at most `perAddress` attempts per client address and `perEmail` per
 * normalised email, across every organisation (C246.3). One Lua script over the two keys of
 * {@link loginLimitKeys} (`KEYS[1]` the address, `KEYS[2]` the email; `ARGV[1]` `perAddress`,
 * `ARGV[2]` `perEmail`, `ARGV[3]` the window in milliseconds) checks and counts atomically: when
 * either key's count has reached its limit the attempt is refused and **counted against neither**
 * (C4's rule), and the script answers the milliseconds until the later blocking window ends;
 * otherwise it increments both, starting a key's window (`PEXPIRE`) when its count becomes 1, and
 * answers 0. `reset` deletes the email's key after a session opens. Each key names an HMAC-SHA-256
 * under its own subkey (label `LOGIN_LIMIT_KEY_LABEL`, derived as the blind index's subkeys are), of
 * `ip:<address>` and of `email:<normalised email>`, so no address or email sits in a key name, an AOF
 * file or `SCAN` output (review P32). When Valkey does not answer, every use of the limiter (the
 * sign-in and the step-up) answers 503 `login_unavailable` with `Retry-After`
 * (`LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS`), a warn log and the metric
 * `rate_limiter_store_unavailable` (C250.7): it fails closed, for login only.
 */
import { USER_SESSION_TOKEN_TTL_SECONDS } from './tokens.js';

/** C245.1: the bounds and defaults of the two console session limits, in seconds. */
export const CONSOLE_SESSION_TIMEOUTS = Object.freeze({
  idleSeconds: Object.freeze({ min: 300, max: 86_400, default: 1800 }),
  absoluteSeconds: Object.freeze({
    min: 3600,
    max: 86_400,
    default: USER_SESSION_TOKEN_TTL_SECONDS,
  }),
});

/** C245.1: the most often a session's `last_seen_at` is written (ours: one write a minute). */
export const SESSION_LAST_SEEN_WRITE_SECONDS = 60;

/** C246.1: C4's two fixed windows, unchanged by the move to Valkey. */
export const LOGIN_LIMITS = Object.freeze({ windowSeconds: 900, perAddress: 50, perEmail: 10 });

/** C246.1 (review P32): the label of the subkey the two key names are HMACs under. */
export const LOGIN_LIMIT_KEY_LABEL = 'openverify/login-limit/v1';

/** C246.2: the `Retry-After` of `login_unavailable` (ours: a store restart takes seconds). */
export const LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

const LOGIN_LIMIT_KEY_PREFIX = 'openverify:login-limit:v1:';
const HMAC_HEX = /^[0-9a-f]{64}$/;

/**
 * C246.1: the two Valkey keys of one attempt, `[address, email]`, from the HMACs of `ip:<address>`
 * and `email:<normalised email>` under the login-limit subkey (lowercase hex).
 * @throws {RangeError} when either is not a 64-character lowercase hex HMAC, so a raw address or
 * email can never become a key name.
 */
export function loginLimitKeys(input: {
  readonly addressHmac: string;
  readonly emailHmac: string;
}): readonly [string, string] {
  if (!HMAC_HEX.test(input.addressHmac) || !HMAC_HEX.test(input.emailHmac)) {
    throw new RangeError('A login limit key is an HMAC-SHA-256 in lowercase hex.');
  }
  return [
    `${LOGIN_LIMIT_KEY_PREFIX}a:${input.addressHmac}`,
    `${LOGIN_LIMIT_KEY_PREFIX}e:${input.emailHmac}`,
  ];
}
