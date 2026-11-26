/**
 * The selfie capture (C40.1): one camera or upload session of a selfie verification, issued by
 * the server with a nonce, an expiry and ordered pose prompts, and consumed once by submit.
 *
 * `initiated` -> `submitted` -> `processed` | `errored`, and `initiated` -> `errored`. An
 * initiated capture errors when a new one supersedes it, when it has expired by the next
 * create, or when its verification is canceled; a submitted one errors only when processing
 * fails without data. Each status names its `selfie.*` event (C40.8).
 */
import { z } from 'zod';
import { DomainError } from './errors.js';

export const SELFIE_CAPTURE_STATUSES = ['initiated', 'submitted', 'processed', 'errored'] as const;
export const selfieCaptureStatusSchema = z.enum(SELFIE_CAPTURE_STATUSES);
export type SelfieCaptureStatus = z.infer<typeof selfieCaptureStatusSchema>;

/** Why a capture errored (C40.1 `error-code`). */
export const SELFIE_CAPTURE_ERROR_CODES = [
  'superseded',
  'expired',
  'canceled',
  'processing_failed',
] as const;
export const selfieCaptureErrorCodeSchema = z.enum(SELFIE_CAPTURE_ERROR_CODES);
export type SelfieCaptureErrorCode = z.infer<typeof selfieCaptureErrorCodeSchema>;

/** `capture-method`, one enum everywhere (C40.1): a live camera, or a sandbox upload (C19). */
export const SELFIE_CAPTURE_METHODS = ['camera', 'upload'] as const;
export const selfieCaptureMethodSchema = z.enum(SELFIE_CAPTURE_METHODS);
export type SelfieCaptureMethod = z.infer<typeof selfieCaptureMethodSchema>;

export const SELFIE_CAPTURE_EVENT_BY_STATUS = Object.freeze({
  initiated: 'selfie.created',
  submitted: 'selfie.submitted',
  processed: 'selfie.processed',
  errored: 'selfie.errored',
} as const satisfies Record<SelfieCaptureStatus, `selfie.${string}`>);

export type SelfieCaptureEventName =
  (typeof SELFIE_CAPTURE_EVENT_BY_STATUS)[keyof typeof SELFIE_CAPTURE_EVENT_BY_STATUS];

export const selfieCaptureEventNameSchema = z.enum([
  'selfie.created',
  'selfie.submitted',
  'selfie.processed',
  'selfie.errored',
] as const satisfies readonly SelfieCaptureEventName[]);

export const SELFIE_CAPTURE_TRANSITIONS: Readonly<
  Record<SelfieCaptureStatus, readonly SelfieCaptureStatus[]>
> = Object.freeze({
  initiated: Object.freeze(['submitted', 'errored'] as const),
  submitted: Object.freeze(['processed', 'errored'] as const),
  processed: Object.freeze([]),
  errored: Object.freeze([]),
});

/** The error codes each status may error with. */
const ERROR_CODES_FROM: Readonly<Partial<Record<SelfieCaptureStatus, readonly string[]>>> = {
  initiated: ['superseded', 'expired', 'canceled'],
  submitted: ['processing_failed'],
};

export class InvalidSelfieCaptureTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string, errorCode?: string) {
    super(
      'invalid_selfie_capture_transition',
      `Selfie capture cannot transition from "${from}" to "${to}"` +
        (errorCode === undefined ? '' : ` with error code "${errorCode}"`),
    );
    this.from = from;
    this.to = to;
  }
}

/** Whether the table allows `from` -> `to` (any error code). */
export function canTransitionSelfieCapture(from: string, to: string): boolean {
  // Own-property lookup, so prototype keys such as "constructor" are not statuses.
  if (!Object.hasOwn(SELFIE_CAPTURE_TRANSITIONS, from)) {
    return false;
  }
  return (SELFIE_CAPTURE_TRANSITIONS[from as SelfieCaptureStatus] as readonly string[]).includes(
    to,
  );
}

/**
 * Checks a transition and returns the event it emits. `errored` needs an error code allowed
 * from `from`; any other target refuses one.
 * @throws {InvalidSelfieCaptureTransitionError}
 */
export function assertSelfieCaptureTransition(
  from: SelfieCaptureStatus,
  to: SelfieCaptureStatus,
  errorCode?: SelfieCaptureErrorCode,
): SelfieCaptureEventName {
  const codeAllowed =
    to === 'errored'
      ? errorCode !== undefined && (ERROR_CODES_FROM[from] ?? []).includes(errorCode)
      : errorCode === undefined;
  if (!canTransitionSelfieCapture(from, to) || !codeAllowed) {
    throw new InvalidSelfieCaptureTransitionError(from, to, errorCode);
  }
  return SELFIE_CAPTURE_EVENT_BY_STATUS[to];
}
