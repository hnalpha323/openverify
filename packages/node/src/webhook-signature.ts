/**
 * Webhook signatures (contract C5).
 *
 * Header: `OpenVerify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * During secret rotation the sender adds one `v1=` value per active secret, separated by a
 * single space. A receiver accepts the delivery when any `v1` matches any of its secrets and
 * the timestamp is within the tolerance (300 seconds by default) of its own clock.
 *
 * Error handling: `verifyWebhookSignature` THROWS a `WebhookSignatureError` for every rejected
 * delivery and returns only on success. It throws rather than returning a result object so
 * that forgetting to check the outcome fails closed: an unchecked result object is truthy and
 * would accept forged deliveries. Invalid arguments from the caller (no secrets, a bad
 * tolerance or clock) are programming errors and throw `TypeError` or `RangeError`.
 *
 * Always verify the raw request body bytes exactly as received; re-serialized JSON differs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header name, lowercase as Node.js exposes it in `request.headers`. */
export const OPENVERIFY_SIGNATURE_HEADER = 'openverify-signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;
/** Most `v1` values one header may carry (one per active secret during rotation). */
export const MAX_SIGNATURES = 8;

/** Largest timestamp a header can carry: 12 digits, which also catches milliseconds. */
const MAX_TIMESTAMP_SECONDS = 999_999_999_999;
const MAX_HEADER_LENGTH = 1024;
const HEADER_PATTERN = new RegExp(
  `^t=(?:0|[1-9][0-9]{0,11}),v1=[0-9a-fA-F]{64}(?: v1=[0-9a-fA-F]{64}){0,${String(MAX_SIGNATURES - 1)}}$`,
);

export type WebhookSignatureErrorCode =
  'malformed_header' | 'no_matching_signature' | 'timestamp_outside_tolerance';

const MESSAGES: Readonly<Record<WebhookSignatureErrorCode, string>> = {
  malformed_header: 'The OpenVerify-Signature header is missing or malformed.',
  no_matching_signature: 'No webhook signature matches the body and the configured secrets.',
  timestamp_outside_tolerance: 'The webhook signature timestamp is outside the allowed tolerance.',
};

/** A delivery failed verification. `code` says why; the message never contains secrets. */
export class WebhookSignatureError extends Error {
  override name = 'WebhookSignatureError';
  readonly code: WebhookSignatureErrorCode;

  constructor(code: WebhookSignatureErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

export type WebhookBody = string | Uint8Array;

function toBytes(body: WebhookBody): Uint8Array {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  throw new TypeError('The webhook body must be a string or bytes (the raw request body)');
}

function toSecrets(secrets: string | readonly string[]): readonly string[] {
  const list = typeof secrets === 'string' ? [secrets] : secrets;
  if (list.length === 0 || list.some((secret) => typeof secret !== 'string' || secret === '')) {
    throw new TypeError('At least one non-empty webhook secret is required');
  }
  return list;
}

function assertTimestamp(timestampSeconds: number): void {
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < 0 ||
    timestampSeconds > MAX_TIMESTAMP_SECONDS
  ) {
    throw new RangeError('The timestamp must be a whole number of seconds since the Unix epoch');
  }
}

function hmac(secret: string, timestamp: string, body: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(body).digest();
}

/**
 * Lowercase hex HMAC-SHA256 of `"<timestampSeconds>.<body>"` with `secret`.
 * @throws {RangeError} for a timestamp that is not whole seconds.
 * @throws {TypeError} for an empty secret or a body that is not a string or bytes.
 */
export function computeWebhookSignature(
  body: WebhookBody,
  secret: string,
  timestampSeconds: number,
): string {
  assertTimestamp(timestampSeconds);
  toSecrets(secret);
  return hmac(secret, String(timestampSeconds), toBytes(body)).toString('hex');
}

/**
 * The `OpenVerify-Signature` header value for a delivery: one `v1` per secret, in order.
 * @throws {RangeError} for a timestamp that is not whole seconds, or too many secrets.
 * @throws {TypeError} for missing secrets or a body that is not a string or bytes.
 */
export function signWebhookPayload(
  body: WebhookBody,
  secret: string | readonly string[],
  timestampSeconds: number,
): string {
  assertTimestamp(timestampSeconds);
  const secrets = toSecrets(secret);
  if (secrets.length > MAX_SIGNATURES) {
    throw new RangeError(`A header carries at most ${String(MAX_SIGNATURES)} signatures`);
  }
  const bytes = toBytes(body);
  const timestamp = String(timestampSeconds);
  const signatures = secrets.map((key) => `v1=${hmac(key, timestamp, bytes).toString('hex')}`);
  return `t=${timestamp},${signatures.join(' ')}`;
}

export interface VerifyWebhookSignatureOptions {
  /** The raw request body, exactly as received. */
  body: WebhookBody;
  /** The `openverify-signature` header; Node.js may give an array or `undefined`. */
  header: string | readonly string[] | null | undefined;
  /** The webhook's active secret, or several during rotation. */
  secrets: string | readonly string[];
  /** Largest allowed clock difference, in either direction. Defaults to 300 seconds. */
  toleranceSeconds?: number;
  /** The receiver's clock. Defaults to now. */
  now?: Date;
}

export interface VerifiedWebhookSignature {
  /** The signed timestamp (unix seconds). */
  timestamp: number;
}

/** The header as one string; a missing or repeated header has none. */
function headerValue(header: VerifyWebhookSignatureOptions['header']): string | null {
  if (typeof header === 'string') {
    return header;
  }
  const values = header ?? [];
  return values.length === 1 ? values.join('') : null;
}

/**
 * Verifies a webhook delivery. Checks run in this order: header format, signature, timestamp.
 * @returns the signed timestamp.
 * @throws {WebhookSignatureError} when the delivery must be rejected.
 * @throws {TypeError | RangeError} for invalid arguments (a programming error).
 */
export function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): VerifiedWebhookSignature {
  const secrets = toSecrets(options.secrets);
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) {
    throw new RangeError('toleranceSeconds must be a positive number of seconds');
  }
  const nowMs = (options.now ?? new Date()).getTime();
  if (Number.isNaN(nowMs)) {
    throw new TypeError('now must be a valid Date');
  }
  const bytes = toBytes(options.body);

  const value = headerValue(options.header);
  if (value === null || value.length > MAX_HEADER_LENGTH || !HEADER_PATTERN.test(value)) {
    throw new WebhookSignatureError('malformed_header');
  }
  // The pattern guarantees `t=<digits>,v1=<64 hex>[ v1=<64 hex>]...`.
  const comma = value.indexOf(',');
  const timestamp = value.slice('t='.length, comma);
  const candidates = value
    .slice(comma + 1)
    .split(' ')
    .map((entry) => Buffer.from(entry.slice('v1='.length), 'hex'));

  let matched = false;
  for (const secret of secrets) {
    const expected = hmac(secret, timestamp, bytes);
    for (const candidate of candidates) {
      // Every pair is compared, in constant time, so timing reveals nothing about which matched.
      if (timingSafeEqual(expected, candidate)) {
        matched = true;
      }
    }
  }
  if (!matched) {
    throw new WebhookSignatureError('no_matching_signature');
  }

  const signedAt = Number(timestamp);
  if (Math.abs(Math.floor(nowMs / 1000) - signedAt) > toleranceSeconds) {
    throw new WebhookSignatureError('timestamp_outside_tolerance');
  }
  return { timestamp: signedAt };
}
