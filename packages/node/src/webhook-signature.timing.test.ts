import { afterEach, describe, expect, it, vi } from 'vitest';

const timingSafeEqual = vi.hoisted(() =>
  vi.fn<(a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => boolean>(),
);

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual };
});

const { signWebhookPayload, verifyWebhookSignature } = await import('./webhook-signature.js');

afterEach(() => {
  timingSafeEqual.mockClear();
});

describe('signature comparison', () => {
  it('compares every candidate signature in constant time', () => {
    const secret = 'wbhsec_test_ONLY_not_a_real_secret_000000000000001';
    const header = signWebhookPayload('{}', secret, 1792497600);
    const rotated = `${header} v1=${'0'.repeat(64)}`;

    expect(() =>
      verifyWebhookSignature({
        body: '{}',
        header: rotated,
        secrets: ['wbhsec_test_ONLY_not_a_real_secret_000000000000009'],
        now: new Date(1792497600 * 1000),
      }),
    ).toThrow();
    // One secret, two candidate signatures: two constant-time comparisons, no early `===`.
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    for (const [left, right] of timingSafeEqual.mock.calls) {
      expect(left.byteLength).toBe(32);
      expect(right.byteLength).toBe(32);
    }
  });
});
