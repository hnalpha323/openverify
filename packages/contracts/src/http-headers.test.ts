import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_TTL_SECONDS,
  IDEMPOTENT_REPLAYED_HEADER,
  RATE_LIMIT_LIMIT_HEADER,
  RATE_LIMIT_REMAINING_HEADER,
  RATE_LIMIT_RESET_HEADER,
  RETRY_AFTER_HEADER,
  idempotencyKeySchema,
} from './http-headers.js';

describe('idempotency (C12)', () => {
  it('uses the Idempotency-Key and Idempotent-Replayed headers for 24 hours', () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe('idempotency-key');
    expect(IDEMPOTENT_REPLAYED_HEADER).toBe('idempotent-replayed');
    expect(IDEMPOTENCY_KEY_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it.each([
    'a',
    '01M5CJXHG07XPHF3HRM6NREDH7',
    'order 1234/retry #2',
    '~!@#$%^&*()_+{}|:"<>?',
    'k'.repeat(255),
  ])('accepts the key %j', (key) => {
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['256 characters', 'k'.repeat(256)],
    ['a leading space', ' key'],
    ['a trailing space', 'key '],
    ['a control character', 'key\u0007'],
    ['a newline', 'key\nnext'],
    ['non-ASCII', 'clé'],
  ])('rejects a key with %s', (_name, key) => {
    expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('rate limit headers (C12)', () => {
  it('follow the RateLimit header fields draft and Retry-After', () => {
    expect(RATE_LIMIT_LIMIT_HEADER).toBe('ratelimit-limit');
    expect(RATE_LIMIT_REMAINING_HEADER).toBe('ratelimit-remaining');
    expect(RATE_LIMIT_RESET_HEADER).toBe('ratelimit-reset');
    expect(RETRY_AFTER_HEADER).toBe('retry-after');
  });
});
