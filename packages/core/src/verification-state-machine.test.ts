import { describe, expect, it } from 'vitest';
import { VERIFICATION_STATUSES, type VerificationStatus } from './enums.js';
import { DomainError } from './errors.js';
import {
  InvalidVerificationTransitionError,
  VERIFICATION_EVENT_BY_STATUS,
  VERIFICATION_TRANSITIONS,
  allowedVerificationTransitions,
  canTransitionVerification,
  isTerminalVerificationStatus,
  transitionVerification,
  verificationEventForStatus,
  verificationEventNameSchema,
} from './verification-state-machine.js';

/** C10: the only allowed verification transitions. */
const ALLOWED: readonly (readonly [VerificationStatus, VerificationStatus])[] = [
  ['initiated', 'submitted'],
  ['initiated', 'confirmed'],
  ['initiated', 'canceled'],
  ['initiated', 'skipped'],
  ['confirmed', 'submitted'],
  ['confirmed', 'passed'],
  ['confirmed', 'failed'],
  ['confirmed', 'canceled'],
  ['submitted', 'passed'],
  ['submitted', 'failed'],
  // C30.4: a required check without evidence sends the verification to review.
  ['submitted', 'needs_review'],
  // C50.7: the AAMVA job skips a submitted verification of a non-participating jurisdiction.
  ['submitted', 'skipped'],
];

const allowedKeys = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));
const FORBIDDEN = VERIFICATION_STATUSES.flatMap((from) =>
  VERIFICATION_STATUSES.map((to) => [from, to] as const),
).filter(([from, to]) => !allowedKeys.has(`${from}->${to}`));

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('verification status events (C5, C10, C17)', () => {
  it('names the event each status emits; confirmed and requires_retry emit none', () => {
    expect(VERIFICATION_EVENT_BY_STATUS).toEqual({
      initiated: 'verification.created',
      submitted: 'verification.submitted',
      passed: 'verification.passed',
      failed: 'verification.failed',
      canceled: 'verification.canceled',
      skipped: 'verification.skipped',
    });
    expect(Object.isFrozen(VERIFICATION_EVENT_BY_STATUS)).toBe(true);
  });

  it('looks events up by own property only', () => {
    expect(verificationEventForStatus('canceled')).toBe('verification.canceled');
    expect(verificationEventForStatus('confirmed')).toBeNull();
    expect(verificationEventForStatus('requires_retry')).toBeNull();
    expect(verificationEventForStatus('toString' as VerificationStatus)).toBeNull();
  });

  it('validates verification event names with a schema', () => {
    for (const name of Object.values(VERIFICATION_EVENT_BY_STATUS)) {
      expect(verificationEventNameSchema.parse(name)).toBe(name);
    }
    expect(verificationEventNameSchema.safeParse('verification.confirmed').success).toBe(false);
  });
});

describe('verification transitions (C10)', () => {
  it('declares exactly the C10 table', () => {
    const declared = Object.entries(VERIFICATION_TRANSITIONS).flatMap(([from, targets]) =>
      targets.map((to) => `${from}->${to}`),
    );
    expect(declared.sort()).toEqual([...allowedKeys].sort());
    expect(Object.keys(VERIFICATION_TRANSITIONS).sort()).toEqual([...VERIFICATION_STATUSES].sort());
  });

  it.each(ALLOWED)('allows %s -> %s and returns the event of the target', (from, to) => {
    expect(canTransitionVerification(from, to)).toBe(true);
    expect(transitionVerification(from, to)).toBe(verificationEventForStatus(to));
  });

  it('returns the C17 events for cancel and skip', () => {
    expect(transitionVerification('initiated', 'canceled')).toBe('verification.canceled');
    expect(transitionVerification('initiated', 'skipped')).toBe('verification.skipped');
    expect(transitionVerification('submitted', 'passed')).toBe('verification.passed');
    // C50.7: a skip after submit still announces verification.skipped.
    expect(transitionVerification('submitted', 'skipped')).toBe('verification.skipped');
  });

  it('returns null for a transition into confirmed, which has no event', () => {
    expect(transitionVerification('initiated', 'confirmed')).toBeNull();
  });

  it.each(FORBIDDEN)('rejects %s -> %s with a typed error', (from, to) => {
    expect(canTransitionVerification(from, to)).toBe(false);
    const thrown = thrownBy(() => transitionVerification(from, to));
    expect(thrown).toBeInstanceOf(InvalidVerificationTransitionError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      name: 'InvalidVerificationTransitionError',
      code: 'invalid_verification_transition',
      from,
      to,
    });
  });

  it('never lets anything enter the deprecated requires_retry status', () => {
    for (const status of VERIFICATION_STATUSES) {
      expect(canTransitionVerification(status, 'requires_retry')).toBe(false);
    }
  });

  it('never returns to initiated', () => {
    for (const status of VERIFICATION_STATUSES) {
      expect(canTransitionVerification(status, 'initiated')).toBe(false);
    }
  });

  it('treats passed, failed, canceled, skipped, needs_review and requires_retry as terminal', () => {
    expect(VERIFICATION_STATUSES.filter((status) => isTerminalVerificationStatus(status))).toEqual([
      'passed',
      'failed',
      'requires_retry',
      'canceled',
      'skipped',
      'needs_review',
    ]);
  });

  it('enters needs_review only from submitted, with no verification event (C30.4)', () => {
    expect(transitionVerification('submitted', 'needs_review')).toBeNull();
    expect(verificationEventForStatus('needs_review')).toBeNull();
    for (const from of VERIFICATION_STATUSES.filter((status) => status !== 'submitted')) {
      expect(canTransitionVerification(from, 'needs_review'), from).toBe(false);
    }
  });

  it('lists the allowed targets of a status', () => {
    expect(allowedVerificationTransitions('confirmed')).toEqual([
      'submitted',
      'passed',
      'failed',
      'canceled',
    ]);
    expect(allowedVerificationTransitions('skipped')).toEqual([]);
  });

  it.each([
    ['an unknown source status', 'archived', 'passed'],
    ['an unknown target status', 'submitted', 'archived'],
    ['a prototype key as the source', 'constructor', 'submitted'],
    ['a prototype key as the target', 'initiated', 'toString'],
    ['__proto__ as the source', '__proto__', 'submitted'],
  ])('rejects %s at runtime', (_label, from, to) => {
    const run = () => transitionVerification(from as VerificationStatus, to as VerificationStatus);
    expect(run).toThrow(InvalidVerificationTransitionError);
    expect(canTransitionVerification(from as VerificationStatus, to as VerificationStatus)).toBe(
      false,
    );
    expect(isTerminalVerificationStatus(from as VerificationStatus)).toBe(false);
  });

  it.each(['archived', 'constructor', '__proto__'])('returns no targets for %j', (status) => {
    expect(allowedVerificationTransitions(status as VerificationStatus)).toEqual([]);
  });

  it('describes the rejected transition in the error message', () => {
    expect(() => transitionVerification('passed', 'submitted')).toThrow(
      'Verification cannot transition from "passed" to "submitted"',
    );
  });
});
