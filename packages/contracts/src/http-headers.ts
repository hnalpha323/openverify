/** Platform HTTP headers of the server API (contract C12). Names are lowercase, as Node sees them. */
import { z } from 'zod';

/** Optional on server API `POST` and `PATCH` requests. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** `true` on a response replayed from the idempotency store. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';
/** A key and its stored response are kept for 24 hours. */
export const IDEMPOTENCY_KEY_TTL_SECONDS = 24 * 60 * 60;

/**
 * 1 to 255 printable ASCII characters. Surrounding spaces are refused, because HTTP parsers
 * trim them and two clients would then send different keys that arrive as one.
 */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/, 'must be printable ASCII');

export const RATE_LIMIT_LIMIT_HEADER = 'ratelimit-limit';
export const RATE_LIMIT_REMAINING_HEADER = 'ratelimit-remaining';
/** Seconds until the limit resets. */
export const RATE_LIMIT_RESET_HEADER = 'ratelimit-reset';
export const RETRY_AFTER_HEADER = 'retry-after';
