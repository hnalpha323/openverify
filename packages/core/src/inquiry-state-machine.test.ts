import { describe, expect, it } from 'vitest';
import { INQUIRY_STATUSES, type InquiryStatus } from './enums.js';
import { DomainError } from './errors.js';
import {
  INQUIRY_EVENT_BY_STATUS,
  INQUIRY_REOPEN_TRANSITIONS,
  INQUIRY_TRANSITIONS,
  InvalidInquiryTransitionError,
  allowedInquiryTransitions,
  canTransitionInquiry,
  inquiryEventNameSchema,
  isTerminalInquiryStatus,
  transitionInquiry,
} from './inquiry-state-machine.js';

const ALLOWED: readonly (readonly [InquiryStatus, InquiryStatus])[] = [
  ['created', 'pending'],
  ['created', 'expired'],
  ['pending', 'completed'],
  ['pending', 'failed'],
  ['pending', 'expired'],
  ['completed', 'approved'],
  ['completed', 'declined'],
  ['completed', 'needs_review'],
  ['failed', 'approved'],
  ['failed', 'declined'],
  ['failed', 'needs_review'],
  ['needs_review', 'approved'],
  ['needs_review', 'declined'],
];

const allowedKeys = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
const ALL_PAIRS = INQUIRY_STATUSES.flatMap((from) =>
  INQUIRY_STATUSES.map((to) => [from, to] as const),
);
const FORBIDDEN = ALL_PAIRS.filter(([from, to]) => !allowedKeys.has(`${from}->${to}`));

describe('inquiry status events', () => {
  it('maps every status to its event name', () => {
    expect(INQUIRY_EVENT_BY_STATUS).toEqual({
      created: 'inquiry.created',
      pending: 'inquiry.started',
      completed: 'inquiry.completed',
      failed: 'inquiry.failed',
      expired: 'inquiry.expired',
      approved: 'inquiry.approved',
      declined: 'inquiry.declined',
      needs_review: 'inquiry.marked-for-review',
    });
  });

  it('validates event names with a schema', () => {
    for (const event of Object.values(INQUIRY_EVENT_BY_STATUS)) {
      expect(inquiryEventNameSchema.parse(event)).toBe(event);
    }
    expect(inquiryEventNameSchema.safeParse('inquiry.needs_review').success).toBe(false);
  });
});

describe('inquiry transitions', () => {
  it('declares exactly the allowed transitions', () => {
    const declared = Object.entries(INQUIRY_TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => `${from}->${to}`),
    );
    expect(declared.sort()).toEqual([...allowedKeys].sort());
  });

  it.each(ALLOWED)('allows %s -> %s and returns the target event', (from, to) => {
    expect(canTransitionInquiry(from, to)).toBe(true);
    expect(transitionInquiry(from, to)).toBe(INQUIRY_EVENT_BY_STATUS[to]);
  });

  it('emits inquiry.marked-for-review when an inquiry needs review', () => {
    expect(transitionInquiry('completed', 'needs_review')).toBe('inquiry.marked-for-review');
  });

  it('emits inquiry.started when an inquiry becomes pending', () => {
    expect(transitionInquiry('created', 'pending')).toBe('inquiry.started');
  });

  it.each(FORBIDDEN)('rejects %s -> %s with a typed error', (from, to) => {
    expect(canTransitionInquiry(from, to)).toBe(false);
    let thrown: unknown;
    try {
      transitionInquiry(from, to);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidInquiryTransitionError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      name: 'InvalidInquiryTransitionError',
      code: 'invalid_inquiry_transition',
      from,
      to,
    });
  });

  it('never allows a status to transition to itself', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(canTransitionInquiry(status, status)).toBe(false);
    }
  });

  it('never allows a transition back to created', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(canTransitionInquiry(status, 'created')).toBe(false);
    }
  });

  it('treats expired, approved and declined as terminal', () => {
    expect(INQUIRY_STATUSES.filter((status) => isTerminalInquiryStatus(status))).toEqual([
      'expired',
      'approved',
      'declined',
    ]);
    expect(allowedInquiryTransitions('approved')).toEqual([]);
  });

  it('lists the allowed targets of a status', () => {
    expect(allowedInquiryTransitions('pending')).toEqual(['completed', 'failed', 'expired']);
  });

  it.each([
    ['an unknown source status', 'archived', 'approved'],
    ['an unknown target status', 'pending', 'archived'],
    ['a prototype key as the source', 'constructor', 'pending'],
    ['a prototype key as the target', 'created', 'toString'],
    ['__proto__ as the source', '__proto__', 'pending'],
  ])('rejects %s at runtime', (_label, from, to) => {
    const transition = (): unknown => transitionInquiry(from as InquiryStatus, to as InquiryStatus);
    expect(transition).toThrow(InvalidInquiryTransitionError);
    expect(canTransitionInquiry(from as InquiryStatus, to as InquiryStatus)).toBe(false);
    // Unknown statuses are rejected, not treated as terminal.
    expect(isTerminalInquiryStatus(from as InquiryStatus)).toBe(false);
  });

  it('returns no targets for an unknown status', () => {
    expect(allowedInquiryTransitions('archived' as InquiryStatus)).toEqual([]);
  });

  it('describes the rejected transition in the error message', () => {
    expect(() => transitionInquiry('approved', 'pending')).toThrow(
      'Inquiry cannot transition from "approved" to "pending"',
    );
  });
});

describe('the reopen edge (C128.6, V22)', () => {
  it('moves a declined inquiry to review under its own event, only when named', () => {
    expect(INQUIRY_REOPEN_TRANSITIONS).toEqual({ declined: ['needs_review'] });
    expect(canTransitionInquiry('declined', 'needs_review', { reopen: true })).toBe(true);
    expect(transitionInquiry('declined', 'needs_review', { reopen: true })).toBe(
      'inquiry.reopened',
    );
    expect(inquiryEventNameSchema.parse('inquiry.reopened')).toBe('inquiry.reopened');
  });

  it('is refused to every caller that does not name it, so a mark-for-review stays a 409', () => {
    expect(canTransitionInquiry('declined', 'needs_review')).toBe(false);
    expect(() => transitionInquiry('declined', 'needs_review')).toThrow(
      InvalidInquiryTransitionError,
    );
  });

  it('is one edge: naming it opens no other move, and keeps the event of the ordinary ones', () => {
    expect(canTransitionInquiry('declined', 'approved', { reopen: true })).toBe(false);
    expect(canTransitionInquiry('approved', 'needs_review', { reopen: true })).toBe(false);
    expect(canTransitionInquiry('expired', 'needs_review', { reopen: true })).toBe(false);
    expect(canTransitionInquiry('completed', 'needs_review', { reopen: true })).toBe(false);
    expect(transitionInquiry('completed', 'needs_review')).toBe('inquiry.marked-for-review');
  });

  it('leaves a declined inquiry terminal for everything that reads the ordinary table', () => {
    expect(isTerminalInquiryStatus('declined')).toBe(true);
    expect(allowedInquiryTransitions('declined')).toEqual([]);
    expect(INQUIRY_TRANSITIONS.declined).toEqual([]);
  });
});
