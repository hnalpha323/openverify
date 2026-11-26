import { readFileSync } from 'node:fs';
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_SECONDS,
  MAX_SIGNATURES,
  OPENVERIFY_SIGNATURE_HEADER,
  WebhookSignatureError,
  computeWebhookSignature,
  signWebhookPayload,
  verifyWebhookSignature,
  type WebhookSignatureErrorCode,
} from './webhook-signature.js';

interface Vectors {
  sign: {
    name: string;
    secret: string;
    timestamp: number;
    body: string;
    signature: string;
    header: string;
  }[];
  signMultiple: {
    name: string;
    secrets: string[];
    timestamp: number;
    body: string;
    header: string;
  }[];
  verify: {
    name: string;
    secrets: string[];
    body: string;
    header: string;
    now: number;
    toleranceSeconds?: number;
    expected: { valid: true } | { valid: false; reason: WebhookSignatureErrorCode };
  }[];
}

/** Golden vectors shared with other languages (contracts/fixtures/webhooks). */
const vectors = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/webhooks/signature-vectors.json', import.meta.url),
    'utf8',
  ),
) as Vectors;

const SECRET = 'wbhsec_test_ONLY_not_a_real_secret_000000000000001';
const OTHER_SECRET = 'wbhsec_test_ONLY_not_a_real_secret_000000000000002';
const T = 1792497600;
const BODY = '{"data":{"type":"event"}}';
const at = (seconds: number) => new Date(seconds * 1000);

function failure(run: () => unknown): WebhookSignatureError {
  try {
    run();
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a WebhookSignatureError');
}

describe('constants', () => {
  it('match the contract (C5)', () => {
    expect(OPENVERIFY_SIGNATURE_HEADER).toBe(WEBHOOK_SIGNATURE_HEADER);
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
    expect(MAX_SIGNATURES).toBe(8);
  });
});

describe('signWebhookPayload (golden vectors)', () => {
  it.each(vectors.sign)('$name', ({ secret, timestamp, body, signature, header }) => {
    expect(computeWebhookSignature(body, secret, timestamp)).toBe(signature);
    expect(signWebhookPayload(body, secret, timestamp)).toBe(header);
  });

  it.each(vectors.signMultiple)('$name', ({ secrets, timestamp, body, header }) => {
    expect(signWebhookPayload(body, secrets, timestamp)).toBe(header);
  });

  it('signs raw bytes exactly like the equivalent UTF-8 string', () => {
    const [vector] = vectors.sign.filter((entry) => entry.name === 'utf8-body-with-whitespace');
    expect(vector).toBeDefined();
    if (vector !== undefined) {
      const bytes = new TextEncoder().encode(vector.body);
      expect(signWebhookPayload(bytes, vector.secret, vector.timestamp)).toBe(vector.header);
      expect(signWebhookPayload(Buffer.from(bytes), vector.secret, vector.timestamp)).toBe(
        vector.header,
      );
    }
  });

  it.each([
    ['a negative timestamp', -1],
    ['a fractional timestamp', 1.5],
    ['milliseconds by mistake', T * 1000],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
  ])('rejects %s', (_name, timestamp) => {
    expect(() => signWebhookPayload(BODY, SECRET, timestamp)).toThrow(RangeError);
  });

  it('rejects missing secrets', () => {
    expect(() => signWebhookPayload(BODY, '', T)).toThrow(TypeError);
    expect(() => signWebhookPayload(BODY, [], T)).toThrow(TypeError);
    expect(() => signWebhookPayload(BODY, [SECRET, ''], T)).toThrow(TypeError);
  });

  it('rejects more secrets than a header may carry', () => {
    const secrets = Array.from(
      { length: MAX_SIGNATURES + 1 },
      (_, index) => `${SECRET}${String(index)}`,
    );
    expect(() => signWebhookPayload(BODY, secrets, T)).toThrow(RangeError);
  });

  it('rejects a body that is neither a string nor bytes', () => {
    expect(() => signWebhookPayload({ data: {} } as never, SECRET, T)).toThrow(TypeError);
  });
});

describe('verifyWebhookSignature (golden vectors)', () => {
  it.each(vectors.verify)('$name', ({ secrets, body, header, now, toleranceSeconds, expected }) => {
    const run = () =>
      verifyWebhookSignature({
        body,
        header,
        secrets,
        now: at(now),
        ...(toleranceSeconds === undefined ? {} : { toleranceSeconds }),
      });
    if (expected.valid) {
      expect(run()).toEqual({ timestamp: Number(/^t=(\d+)/.exec(header)?.[1]) });
    } else {
      expect(failure(run).code).toBe(expected.reason);
    }
  });
});

describe('verifyWebhookSignature', () => {
  const header = signWebhookPayload(BODY, SECRET, T);

  it('round-trips signWebhookPayload with the current time by default', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh = signWebhookPayload(BODY, SECRET, nowSeconds);
    expect(verifyWebhookSignature({ body: BODY, header: fresh, secrets: SECRET })).toEqual({
      timestamp: nowSeconds,
    });
  });

  it('accepts a single secret or a list, and raw bytes', () => {
    const bytes = new TextEncoder().encode(BODY);
    expect(
      verifyWebhookSignature({ body: bytes, header, secrets: [OTHER_SECRET, SECRET], now: at(T) }),
    ).toEqual({
      timestamp: T,
    });
  });

  it('accepts a Node header value given as a one-element array', () => {
    expect(
      verifyWebhookSignature({ body: BODY, header: [header], secrets: SECRET, now: at(T) }),
    ).toEqual({
      timestamp: T,
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['repeated', [header, header]],
    ['too long', `${header} ${'x'.repeat(2048)}`],
    [
      'carrying too many signatures',
      `t=${String(T)},${Array.from({ length: MAX_SIGNATURES + 1 }, () => `v1=${'0'.repeat(64)}`).join(' ')}`,
    ],
  ])('reports a %s header as malformed', (_name, value) => {
    const error = failure(() =>
      verifyWebhookSignature({ body: BODY, header: value, secrets: SECRET, now: at(T) }),
    );
    expect(error.code).toBe('malformed_header');
  });

  it('accepts the maximum number of signatures', () => {
    const fillers = Array.from({ length: MAX_SIGNATURES - 1 }, () => `v1=${'0'.repeat(64)}`);
    const many = `${header} ${fillers.join(' ')}`;
    expect(
      verifyWebhookSignature({ body: BODY, header: many, secrets: SECRET, now: at(T) }),
    ).toEqual({
      timestamp: T,
    });
  });

  it('throws a typed error whose message never contains the secret or signature', () => {
    const error = failure(() =>
      verifyWebhookSignature({ body: `${BODY} `, header, secrets: SECRET, now: at(T) }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WebhookSignatureError');
    expect(error.code).toBe('no_matching_signature');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(header.slice(-64));
  });

  it.each([
    ['no secrets', { secrets: [] }, TypeError],
    ['an empty secret', { secrets: [''] }, TypeError],
    ['a zero tolerance', { toleranceSeconds: 0 }, RangeError],
    ['a negative tolerance', { toleranceSeconds: -5 }, RangeError],
    ['an infinite tolerance', { toleranceSeconds: Number.POSITIVE_INFINITY }, RangeError],
    ['an invalid clock', { now: new Date(Number.NaN) }, TypeError],
  ])('rejects %s as a programming error', (_name, change, type) => {
    expect(() =>
      verifyWebhookSignature({ body: BODY, header, secrets: SECRET, now: at(T), ...change }),
    ).toThrow(type);
  });
});
