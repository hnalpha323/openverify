/**
 * Verification lifecycle (contract C10). Every status write in the API and the worker goes
 * through `transitionVerification()`, which validates the change and names the event to emit.
 */
import { z } from 'zod';
import type { VerificationStatus } from './enums.js';
import { DomainError } from './errors.js';

/**
 * Event emitted when a verification enters each status (C5, C17). `confirmed` emits none, and
 * nothing ever enters the deprecated `requires_retry`.
 */
export const VERIFICATION_EVENT_BY_STATUS = Object.freeze({
  initiated: 'verification.created',
  submitted: 'verification.submitted',
  passed: 'verification.passed',
  failed: 'verification.failed',
  canceled: 'verification.canceled',
  skipped: 'verification.skipped',
} as const satisfies Partial<Record<VerificationStatus, `verification.${string}`>>);

export type VerificationEventName =
  (typeof VERIFICATION_EVENT_BY_STATUS)[keyof typeof VERIFICATION_EVENT_BY_STATUS];

export const verificationEventNameSchema = z.enum([
  'verification.created',
  'verification.submitted',
  'verification.passed',
  'verification.failed',
  'verification.canceled',
  'verification.skipped',
] as const satisfies readonly VerificationEventName[]);

/**
 * Allowed status transitions (C10, C30.4). `initiated` is only ever the initial status;
 * `passed`, `failed`, `canceled`, `skipped`, `needs_review` and the deprecated `requires_retry`
 * are terminal. `needs_review` emits no verification event: the inquiry's
 * `inquiry.marked-for-review` announces it.
 */
export const VERIFICATION_TRANSITIONS: Readonly<
  Record<VerificationStatus, readonly VerificationStatus[]>
> = Object.freeze({
  initiated: Object.freeze(['submitted', 'confirmed', 'canceled', 'skipped'] as const),
  confirmed: Object.freeze(['submitted', 'passed', 'failed', 'canceled'] as const),
  // C30.4: a required check without evidence leaves the verification to an operator. C50.7:
  // `skipped` only for the AAMVA job, when the jurisdiction does not take part (C59.6).
  submitted: Object.freeze(['passed', 'failed', 'needs_review', 'skipped'] as const),
  passed: Object.freeze([]),
  failed: Object.freeze([]),
  requires_retry: Object.freeze([]),
  canceled: Object.freeze([]),
  skipped: Object.freeze([]),
  needs_review: Object.freeze([]),
});

/** Raised when a caller asks for a transition the state machine forbids. */
export class InvalidVerificationTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      'invalid_verification_transition',
      `Verification cannot transition from "${from}" to "${to}"`,
    );
    this.from = from;
    this.to = to;
  }
}

function isKnownStatus(value: string): value is VerificationStatus {
  // Own-property lookup, so prototype keys such as "constructor" are not statuses.
  return Object.hasOwn(VERIFICATION_TRANSITIONS, value);
}

/** The event for a verification entering `status`, or `null` when none is emitted. */
export function verificationEventForStatus(
  status: VerificationStatus,
): VerificationEventName | null {
  return Object.hasOwn(VERIFICATION_EVENT_BY_STATUS, status)
    ? VERIFICATION_EVENT_BY_STATUS[status as keyof typeof VERIFICATION_EVENT_BY_STATUS]
    : null;
}

/** Statuses a verification may move to from `from`; empty for terminal or unknown statuses. */
export function allowedVerificationTransitions(
  from: VerificationStatus,
): readonly VerificationStatus[] {
  return isKnownStatus(from) ? VERIFICATION_TRANSITIONS[from] : [];
}

export function isTerminalVerificationStatus(status: VerificationStatus): boolean {
  return isKnownStatus(status) && VERIFICATION_TRANSITIONS[status].length === 0;
}

export function canTransitionVerification(
  from: VerificationStatus,
  to: VerificationStatus,
): boolean {
  return isKnownStatus(to) && allowedVerificationTransitions(from).includes(to);
}

/**
 * Validates a status change and returns the event to emit for it, or `null` for a change into
 * `confirmed`, which has no event.
 * @throws {InvalidVerificationTransitionError} when the transition is not allowed.
 */
export function transitionVerification(
  from: VerificationStatus,
  to: VerificationStatus,
): VerificationEventName | null {
  if (!canTransitionVerification(from, to)) {
    throw new InvalidVerificationTransitionError(from, to);
  }
  return verificationEventForStatus(to);
}
