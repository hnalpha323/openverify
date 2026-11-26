/**
 * C55.5, C55.7: the OTP limits, GCRA rules in Valkey outside the C12 policies (`OTP_LIMITS`), all
 * per environment. They **fail closed**: when Valkey cannot answer, the request is refused (503
 * `otp_rate_limited`), unlike the C12 limits.
 *
 * A send consumes, in this order, so that a limit an attacker trips is counted before the shared
 * ones it would drain: `otp-ip-hour` (an IPv4 address or an IPv6 /64), `otp-inquiry-day`,
 * `otp-destination-hour` and `otp-destination-day` (the destination's blind index), and for SMS
 * `otp-sms-prefix-hour` (the first eight E.164 digits), `otp-sms-country-hour` (half the budget per
 * destination country, only when the step allows more than one country) and last the
 * environment's `otp-sms-max-per-hour` budget. The first refusal stops the rest.
 *
 * A wrong code counts against `otp-destination-guess-day` (per destination and channel); once it
 * refuses, a marker in the cache makes every send and confirm to that destination answer 429
 * until the rule would allow one again.
 */
import { isIP } from 'node:net';
import { OTP_LIMITS, OTP_SMS_PREFIX_DIGITS, type OtpLimitName } from '@openverify/contracts';
import type { OtpChannel, OtpLimitedReason } from '@openverify/db';
import type { KeyValueCache, RateLimiter, RateLimitRule } from '../../ports.js';

/** A rule's size: requests per window. */
export interface OtpRuleSize {
  limit: number;
  windowSeconds: number;
}

/** The limits a send can trip: the C55.7 names but the guess budget, which confirms count. */
export type OtpSendLimit = Exclude<OtpLimitName, 'otp-destination-guess-day'>;

/** Rule sizes to use instead of `OTP_LIMITS` (tests only: a short window shows recovery). */
export type OtpRuleOverrides = Partial<Record<OtpLimitName, OtpRuleSize>>;

/** What a send is counted against. */
export interface OtpSendLimitContext {
  environmentId: string;
  inquiryId: string;
  channel: OtpChannel;
  /** `otpDestinationIndex` of the destination (already per environment and channel). */
  destinationIndex: string;
  /** The client address the request came from (`request.ip`). */
  clientIp: string;
  /** For `sms` only. */
  sms?: {
    /** The number in E.164. */
    e164: string;
    /** Its region (ISO 3166-1 alpha-2). */
    country: string;
    /** Whether the step allows more than one country (`otp-sms-country-hour` applies). */
    multipleCountries: boolean;
    /** The environment's `otp-sms-max-per-hour`, under the install ceiling. */
    budgetPerHour: number;
  };
}

/** A limit's answer. */
export type OtpLimitOutcome =
  | { allowed: true }
  | {
      allowed: false;
      limit: OtpSendLimit | 'otp-destination-guess-day';
      /** What `otp_verification_states.limited_reason` records; `null` for the per-IP limit. */
      reason: OtpLimitedReason | null;
      retryAfterSeconds: number;
    }
  /** Valkey could not answer: the request is refused (fail closed). */
  | { allowed: false; storeUnavailable: true };

const KEY_NAMESPACE = 'openverify:otp-guess:';

/** The C55.7 sizes, but the two shares of the environment budget. */
function ruleOf(
  name: Exclude<OtpLimitName, 'otp-sms-country-hour' | 'otp-sms-max-per-hour'>,
  overrides: OtpRuleOverrides,
): RateLimitRule {
  return { name, ...(overrides[name] ?? OTP_LIMITS[name]) };
}

/** An IPv4 address written in the last 32 bits of an IPv6 one (`::ffff:192.0.2.1`). */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const EMBEDDED_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

/** The eight hextets of a valid IPv6 address, as numbers. */
function hextets(address: string): number[] {
  const [head = '', tail] = address.split('::');
  const parts = (text: string) =>
    text === ''
      ? []
      : text.split(':').flatMap((part) => {
          if (EMBEDDED_IPV4.test(part)) {
            const [a = 0, b = 0, c = 0, d = 0] = part.split('.').map(Number);
            return [a * 256 + b, c * 256 + d];
          }
          return [Number.parseInt(part, 16)];
        });
  const front = parts(head);
  const back = tail === undefined ? [] : parts(tail);
  return [...front, ...Array<number>(8 - front.length - back.length).fill(0), ...back];
}

/** C55.7 (P10): the per-IP key: an IPv4 address, or the /64 of an IPv6 one. */
export function otpClientKey(ip: string): string {
  if (isIP(ip) === 4) {
    return ip;
  }
  const address = ip.split('%')[0]?.toLowerCase() ?? '';
  if (isIP(address) !== 6) {
    return ip;
  }
  const words = hextets(address);
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) {
    const [high = 0, low = 0] = words.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(':')}::/64`;
}

interface SendStep {
  limit: OtpSendLimit;
  reason: OtpLimitedReason | null;
  key: string;
  rule: RateLimitRule;
}

/** The rules a send consumes, in order (see the file header). */
function sendSteps(context: OtpSendLimitContext, overrides: OtpRuleOverrides): SendStep[] {
  const env = context.environmentId;
  const destination = `${env}|destination|${context.destinationIndex}`;
  const steps: SendStep[] = [
    {
      limit: 'otp-ip-hour',
      reason: null,
      key: `${env}|ip|${otpClientKey(context.clientIp)}`,
      rule: ruleOf('otp-ip-hour', overrides),
    },
    {
      limit: 'otp-inquiry-day',
      reason: 'inquiry',
      key: `${env}|inquiry|${context.inquiryId}`,
      rule: ruleOf('otp-inquiry-day', overrides),
    },
    {
      limit: 'otp-destination-hour',
      reason: 'destination',
      key: destination,
      rule: ruleOf('otp-destination-hour', overrides),
    },
    {
      limit: 'otp-destination-day',
      reason: 'destination',
      key: destination,
      rule: ruleOf('otp-destination-day', overrides),
    },
  ];
  const { sms } = context;
  if (sms === undefined) {
    return steps;
  }
  steps.push({
    limit: 'otp-sms-prefix-hour',
    reason: 'destination',
    key: `${env}|prefix|${sms.e164.slice(1, 1 + OTP_SMS_PREFIX_DIGITS)}`,
    rule: ruleOf('otp-sms-prefix-hour', overrides),
  });
  const country = OTP_LIMITS['otp-sms-country-hour'];
  if (sms.multipleCountries) {
    steps.push({
      limit: 'otp-sms-country-hour',
      reason: 'environment',
      key: `${env}|country|${sms.country}`,
      rule: {
        name: 'otp-sms-country-hour',
        limit: Math.max(1, Math.floor(sms.budgetPerHour * country.budgetShare)),
        windowSeconds: country.windowSeconds,
        ...overrides['otp-sms-country-hour'],
      },
    });
  }
  const budget = OTP_LIMITS['otp-sms-max-per-hour'];
  steps.push({
    limit: 'otp-sms-max-per-hour',
    reason: 'environment',
    key: `${env}|budget`,
    rule: {
      name: 'otp-sms-max-per-hour',
      limit: Math.max(1, Math.floor(sms.budgetPerHour * budget.budgetShare)),
      windowSeconds: budget.windowSeconds,
      ...overrides['otp-sms-max-per-hour'],
    },
  });
  return steps;
}

/** Consumes the send limits of `context`, stopping at the first refusal; fails closed. */
export async function consumeOtpSendLimits(
  limiter: RateLimiter,
  context: OtpSendLimitContext,
  overrides: OtpRuleOverrides = {},
): Promise<OtpLimitOutcome> {
  for (const step of sendSteps(context, overrides)) {
    let decision;
    try {
      decision = await limiter.consume(step.key, step.rule);
    } catch {
      return { allowed: false, storeUnavailable: true };
    }
    if (!decision.allowed) {
      return {
        allowed: false,
        limit: step.limit,
        reason: step.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }
  }
  return { allowed: true };
}

const guessMarkerKey = (destinationIndex: string) => `${KEY_NAMESPACE}${destinationIndex}`;

const guessRefusal = (retryAfterSeconds: number): OtpLimitOutcome => ({
  allowed: false,
  limit: 'otp-destination-guess-day',
  reason: 'guess',
  retryAfterSeconds,
});

/**
 * Whether the destination's guess budget tripped: a send or confirm to it then answers 429 until
 * the marker's time; fails closed.
 */
export async function guessBudgetOutcome(
  cache: KeyValueCache,
  destinationIndex: string,
  now: Date,
): Promise<OtpLimitOutcome> {
  let marker: string | null;
  try {
    marker = await cache.get(guessMarkerKey(destinationIndex));
  } catch {
    return { allowed: false, storeUnavailable: true };
  }
  const until = marker === null ? Number.NaN : Date.parse(marker);
  return until > now.getTime()
    ? guessRefusal(Math.max(1, Math.ceil((until - now.getTime()) / 1000)))
    : { allowed: true };
}

/**
 * Counts one wrong code against the destination's guess budget; once it refuses, marks the
 * destination until the rule would allow one again; fails closed.
 */
export async function countWrongCode(
  limiter: RateLimiter,
  cache: KeyValueCache,
  destinationIndex: string,
  now: Date,
  overrides: OtpRuleOverrides = {},
): Promise<OtpLimitOutcome> {
  let decision;
  try {
    decision = await limiter.consume(
      `guess|${destinationIndex}`,
      ruleOf('otp-destination-guess-day', overrides),
    );
  } catch {
    return { allowed: false, storeUnavailable: true };
  }
  if (decision.allowed) {
    return { allowed: true };
  }
  const seconds = Math.max(1, decision.retryAfterSeconds);
  try {
    await cache.set(
      guessMarkerKey(destinationIndex),
      new Date(now.getTime() + seconds * 1000).toISOString(),
      seconds,
    );
  } catch {
    // The refusal stands; the next request finds the store down and fails closed anyway.
  }
  return guessRefusal(seconds);
}
