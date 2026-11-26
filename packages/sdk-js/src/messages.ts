/**
 * C159.4: the embed protocol on the embedding page's side. The guard is hand-written (no zod, for
 * the 6 KB budget of C159.1) and held to the flow's frozen `flowToParentMessageSchema` by a test
 * over the same vectors: an unknown member, type or value is refused, so a message from the flow
 * carries nothing but what the protocol names (no personal data, token, step id or field value).
 */

/** The protocol version the client speaks (C159.4). */
export const EMBED_PROTOCOL_VERSION = 1;

/** A message from the flow, as `flowToParentMessageSchema` defines it. */
export type FlowMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'event';
      readonly name: 'start' | 'step-changed' | 'complete' | 'cancel' | 'error';
      readonly metadata?: { readonly 'step-type'?: string };
    }
  | { readonly type: 'resize'; readonly height: number }
  | { readonly type: 'complete'; readonly 'inquiry-id': string; readonly status: string }
  | { readonly type: 'cancel'; readonly 'inquiry-id': string }
  | { readonly type: 'error'; readonly code: string };

const EVENT_NAMES = ['start', 'step-changed', 'complete', 'cancel', 'error'];
const STATUSES = [
  'created',
  'pending',
  'completed',
  'failed',
  'expired',
  'needs_review',
  'approved',
  'declined',
];
const ERROR_CODES = [
  'application_error',
  'camera_error',
  'invalid_config',
  'unauthenticated',
  'inactive_template',
  'unknown',
];
const INQUIRY_ID = /^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

type Data = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Exactly the keys `required`, plus any of `optional` that is present. */
const hasKeys = (data: Data, required: readonly string[], optional: readonly string[] = []) =>
  required.every((key) => key in data) &&
  Object.keys(data).every((key) => required.includes(key) || optional.includes(key));

const oneOf = (value: unknown, values: readonly string[]): value is string =>
  typeof value === 'string' && values.includes(value);

const ENVELOPE = ['source', 'version', 'type'];

/** The flow's message in `data`, or `null` for anything else. */
export function readFlowMessage(data: unknown): FlowMessage | null {
  if (!isRecord(data) || data.source !== 'openverify-flow' || data.version !== 1) {
    return null;
  }
  const id = data['inquiry-id'];
  switch (data.type) {
    case 'ready':
      return hasKeys(data, ENVELOPE) ? { type: 'ready' } : null;
    case 'event': {
      const metadata = data.metadata;
      const validMetadata =
        metadata === undefined ||
        (isRecord(metadata) &&
          hasKeys(metadata, [], ['step-type']) &&
          (metadata['step-type'] === undefined ||
            (typeof metadata['step-type'] === 'string' && metadata['step-type'].length <= 40)));
      if (
        !hasKeys(data, [...ENVELOPE, 'name'], ['metadata']) ||
        !oneOf(data.name, EVENT_NAMES) ||
        !validMetadata
      ) {
        return null;
      }
      return {
        type: 'event',
        name: data.name as 'start',
        ...(metadata === undefined ? {} : { metadata }),
      };
    }
    case 'resize':
      return hasKeys(data, [...ENVELOPE, 'height']) &&
        Number.isInteger(data.height) &&
        (data.height as number) >= 0 &&
        (data.height as number) <= 100_000
        ? { type: 'resize', height: data.height as number }
        : null;
    case 'complete':
      return hasKeys(data, [...ENVELOPE, 'inquiry-id', 'status']) &&
        typeof id === 'string' &&
        INQUIRY_ID.test(id) &&
        oneOf(data.status, STATUSES)
        ? { type: 'complete', 'inquiry-id': id, status: data.status }
        : null;
    case 'cancel':
      return hasKeys(data, [...ENVELOPE, 'inquiry-id']) &&
        typeof id === 'string' &&
        INQUIRY_ID.test(id)
        ? { type: 'cancel', 'inquiry-id': id }
        : null;
    case 'error':
      return hasKeys(data, [...ENVELOPE, 'code']) && oneOf(data.code, ERROR_CODES)
        ? { type: 'error', code: data.code }
        : null;
    default:
      return null;
  }
}
