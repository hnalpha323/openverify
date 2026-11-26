import { z } from 'zod';
import type { InquiryStatus } from './enums.js';
import { DomainError } from './errors.js';

/** Event emitted when an inquiry enters each status. */
export const INQUIRY_EVENT_BY_STATUS = {
  created: 'inquiry.created',
  pending: 'inquiry.started',
  completed: 'inquiry.completed',
  failed: 'inquiry.failed',
  expired: 'inquiry.expired',
  approved: 'inquiry.approved',
  declined: 'inquiry.declined',
  needs_review: 'inquiry.marked-for-review',
} as const satisfies Record<InquiryStatus, string>;

/**
 * C128.6 (V22): ours, the event of the reopen edge, so a reopen never reads as a fresh review:
 * `inquiry.marked-for-review` starts review automations, and this one does not.
 */
export const INQUIRY_REOPENED_EVENT = 'inquiry.reopened';

export type InquiryEventName =
  (typeof INQUIRY_EVENT_BY_STATUS)[InquiryStatus] | typeof INQUIRY_REOPENED_EVENT;

export const inquiryEventNameSchema = z.enum([
  'inquiry.created',
  'inquiry.started',
  'inquiry.completed',
  'inquiry.failed',
  'inquiry.expired',
  'inquiry.approved',
  'inquiry.declined',
  'inquiry.marked-for-review',
  INQUIRY_REOPENED_EVENT,
] as const satisfies readonly InquiryEventName[]);

/**
 * Allowed status transitions. `created` is only ever the initial status, and
 * `expired`, `approved` and `declined` are terminal for everything that reads this table. The one
 * way out of `declined` is {@link INQUIRY_REOPEN_TRANSITIONS}.
 */
export const INQUIRY_TRANSITIONS: Readonly<Record<InquiryStatus, readonly InquiryStatus[]>> = {
  created: ['pending', 'expired'],
  pending: ['completed', 'failed', 'expired'],
  completed: ['approved', 'declined', 'needs_review'],
  failed: ['approved', 'declined', 'needs_review'],
  expired: [],
  approved: [],
  declined: [],
  needs_review: ['approved', 'declined'],
};

/**
 * C128.6 (decisions 50, 79; a C10 amendment): the human review of a decline, a user's act alone. The
 * edge is held apart from {@link INQUIRY_TRANSITIONS} on purpose. That table is what `mark-for-review`,
 * the simulation, the review rules and the console's action list read, and a decline has to stay
 * final for each of them; a caller takes this edge only by naming it, so a new caller fails closed.
 */
export const INQUIRY_REOPEN_TRANSITIONS: Readonly<
  Partial<Record<InquiryStatus, readonly InquiryStatus[]>>
> = { declined: ['needs_review'] };

/** How a caller names the reopen edge. Only the `reopen` action of `applyInquiryAction` does. */
export interface InquiryTransitionOptions {
  readonly reopen?: boolean;
}

/** Raised when a caller asks for a transition the state machine forbids. */
export class InvalidInquiryTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super('invalid_inquiry_transition', `Inquiry cannot transition from "${from}" to "${to}"`);
    this.from = from;
    this.to = to;
  }
}

function isKnownStatus(value: string): value is InquiryStatus {
  // Own-property lookup, so prototype keys such as "constructor" are not statuses.
  return Object.hasOwn(INQUIRY_TRANSITIONS, value);
}

/** Statuses an inquiry may move to from `from`; empty for terminal or unknown statuses. */
export function allowedInquiryTransitions(from: InquiryStatus): readonly InquiryStatus[] {
  return isKnownStatus(from) ? INQUIRY_TRANSITIONS[from] : [];
}

export function isTerminalInquiryStatus(status: InquiryStatus): boolean {
  return isKnownStatus(status) && INQUIRY_TRANSITIONS[status].length === 0;
}

export function canTransitionInquiry(
  from: InquiryStatus,
  to: InquiryStatus,
  options: InquiryTransitionOptions = {},
): boolean {
  if (options.reopen === true) {
    return INQUIRY_REOPEN_TRANSITIONS[from]?.includes(to) === true;
  }
  return isKnownStatus(to) && allowedInquiryTransitions(from).includes(to);
}

/**
 * Validates a status change and returns the event to emit for it.
 * @throws {InvalidInquiryTransitionError} when the transition is not allowed.
 */
export function transitionInquiry(
  from: InquiryStatus,
  to: InquiryStatus,
  options: InquiryTransitionOptions = {},
): InquiryEventName {
  if (!canTransitionInquiry(from, to, options)) {
    throw new InvalidInquiryTransitionError(from, to);
  }
  // V22: the one-event-per-status map gains its per-edge override here.
  return options.reopen === true ? INQUIRY_REOPENED_EVENT : INQUIRY_EVENT_BY_STATUS[to];
}
