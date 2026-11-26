/**
 * Workflow request signatures (plan C124.6; decision 35). A receiver of a workflow's HTTPS step
 * verifies it here, and never with webhook code:
 *
 * `OpenVerify-Request-Signature: t=<unix seconds>,w1=<hex HMAC-SHA256(secret,
 * "workflow.<t>.<METHOD>.<target>.<raw body>")>`, where `target` is the path and query as sent, and a
 * GET or DELETE signs an empty body. During rotation the sender adds one `w1=` per active secret.
 *
 * The format is its own so that a workflow can never forge an OpenVerify webhook (P01). The label
 * `w1` fails the webhook header's pattern, and the signed text starts with `workflow.` where a webhook's
 * starts with a digit, so relabelling the value as `v1` fails too, even when an operator stores the
 * same secret value in both places.
 *
 * Like `verifyWebhookSignature`, verification throws for every rejected request and returns only on
 * success, so forgetting to check the outcome fails closed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULT_TOLERANCE_SECONDS, MAX_SIGNATURES } from './webhook-signature.js';

/** Header name, lowercase as Node.js exposes it in `request.headers`. */
export const OPENVERIFY_REQUEST_SIGNATURE_HEADER = 'openverify-request-signature';

/** Largest timestamp a header can carry: 12 digits, which also catches milliseconds. */
const MAX_TIMESTAMP_SECONDS = 999_999_999_999;
const MAX_HEADER_LENGTH = 1024;
const HEADER_PATTERN = new RegExp(
  `^t=(?:0|[1-9][0-9]{0,11}),w1=[0-9a-fA-F]{64}(?: w1=[0-9a-fA-F]{64}){0,${String(MAX_SIGNATURES - 1)}}$`,
);
const METHOD_PATTERN = /^[A-Za-z]{1,16}$/;

export type WorkflowRequestSignatureErrorCode =
  'malformed_header' | 'no_matching_signature' | 'timestamp_outside_tolerance';

const MESSAGES: Readonly<Record<WorkflowRequestSignatureErrorCode, string>> = {
  malformed_header: 'The OpenVerify-Request-Signature header is missing or malformed.',
  no_matching_signature: 'No request signature matches the request and the configured secrets.',
  timestamp_outside_tolerance: 'The request signature timestamp is outside the allowed tolerance.',
};

/** A request failed verification. `code` says why; the message never contains secrets. */
export class WorkflowRequestSignatureError extends Error {
  override name = 'WorkflowRequestSignatureError';
  readonly code: WorkflowRequestSignatureErrorCode;

  constructor(code: WorkflowRequestSignatureErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

export interface WorkflowRequestParts {
  method: string;
  /** The path and query as sent, starting with `/`. */
  target: string;
  /** The raw body; left out, an empty one. */
  body?: string | Uint8Array;
}

function toBytes(body: WorkflowRequestParts['body']): Uint8Array {
  if (body === undefined) {
    return new Uint8Array();
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  throw new TypeError('The request body must be a string or bytes (the raw request body)');
}

function toSecrets(secrets: string | readonly string[]): readonly string[] {
  const list = typeof secrets === 'string' ? [secrets] : secrets;
  if (list.length === 0 || list.some((secret) => typeof secret !== 'string' || secret === '')) {
    throw new TypeError('At least one non-empty workflow secret is required');
  }
  return list;
}

function assertParts({ method, target }: WorkflowRequestParts): void {
  if (!METHOD_PATTERN.test(method)) {
    throw new TypeError('The method must be an HTTP method name');
  }
  if (!target.startsWith('/')) {
    throw new TypeError('The target must be the path and query, starting with /');
  }
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

function hmac(secret: string, timestamp: string, request: WorkflowRequestParts): Buffer {
  return createHmac('sha256', secret)
    .update(`workflow.${timestamp}.${request.method.toUpperCase()}.${request.target}.`, 'utf8')
    .update(toBytes(request.body))
    .digest();
}

/**
 * The `OpenVerify-Request-Signature` header value for a request: one `w1` per secret, in order.
 * @throws {RangeError} for a timestamp that is not whole seconds, or too many secrets.
 * @throws {TypeError} for missing secrets, or a method, target or body that cannot be signed.
 */
export function signWorkflowRequest(
  request: WorkflowRequestParts,
  secret: string | readonly string[],
  timestampSeconds: number,
): string {
  assertTimestamp(timestampSeconds);
  assertParts(request);
  const secrets = toSecrets(secret);
  if (secrets.length > MAX_SIGNATURES) {
    throw new RangeError(`A header carries at most ${String(MAX_SIGNATURES)} signatures`);
  }
  const timestamp = String(timestampSeconds);
  const signatures = secrets.map((key) => `w1=${hmac(key, timestamp, request).toString('hex')}`);
  return `t=${timestamp},${signatures.join(' ')}`;
}

export interface VerifyWorkflowRequestSignatureOptions extends WorkflowRequestParts {
  /** The `openverify-request-signature` header; Node.js may give an array or `undefined`. */
  header: string | readonly string[] | null | undefined;
  /** The workflow secret's value, or several during rotation. */
  secrets: string | readonly string[];
  /** Largest allowed clock difference, in either direction. Defaults to 300 seconds. */
  toleranceSeconds?: number;
  /** The receiver's clock. Defaults to now. */
  now?: Date;
}

export interface VerifiedWorkflowRequestSignature {
  /** The signed timestamp (unix seconds). */
  timestamp: number;
}

function headerValue(header: VerifyWorkflowRequestSignatureOptions['header']): string | null {
  if (typeof header === 'string') {
    return header;
  }
  const values = header ?? [];
  return values.length === 1 ? values.join('') : null;
}

/**
 * Verifies a workflow request. Checks run in this order: header format, signature, timestamp.
 * @returns the signed timestamp.
 * @throws {WorkflowRequestSignatureError} when the request must be rejected.
 * @throws {TypeError | RangeError} for invalid arguments (a programming error).
 */
export function verifyWorkflowRequestSignature(
  options: VerifyWorkflowRequestSignatureOptions,
): VerifiedWorkflowRequestSignature {
  const secrets = toSecrets(options.secrets);
  assertParts(options);
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) {
    throw new RangeError('toleranceSeconds must be a positive number of seconds');
  }
  const nowMs = (options.now ?? new Date()).getTime();
  if (Number.isNaN(nowMs)) {
    throw new TypeError('now must be a valid Date');
  }

  const value = headerValue(options.header);
  if (value === null || value.length > MAX_HEADER_LENGTH || !HEADER_PATTERN.test(value)) {
    throw new WorkflowRequestSignatureError('malformed_header');
  }
  // The pattern guarantees `t=<digits>,w1=<64 hex>[ w1=<64 hex>]...`.
  const comma = value.indexOf(',');
  const timestamp = value.slice('t='.length, comma);
  const candidates = value
    .slice(comma + 1)
    .split(' ')
    .map((entry) => Buffer.from(entry.slice('w1='.length), 'hex'));

  let matched = false;
  for (const secret of secrets) {
    const expected = hmac(secret, timestamp, options);
    for (const candidate of candidates) {
      // Every pair is compared, in constant time, so timing reveals nothing about which matched.
      if (timingSafeEqual(expected, candidate)) {
        matched = true;
      }
    }
  }
  if (!matched) {
    throw new WorkflowRequestSignatureError('no_matching_signature');
  }

  const signedAt = Number(timestamp);
  if (Math.abs(Math.floor(nowMs / 1000) - signedAt) > toleranceSeconds) {
    throw new WorkflowRequestSignatureError('timestamp_outside_tolerance');
  }
  return { timestamp: signedAt };
}
