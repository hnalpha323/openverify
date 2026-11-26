import { describe, expect, it } from 'vitest';
import {
  InvalidSelfieCaptureTransitionError,
  SELFIE_CAPTURE_ERROR_CODES,
  SELFIE_CAPTURE_EVENT_BY_STATUS,
  SELFIE_CAPTURE_METHODS,
  SELFIE_CAPTURE_STATUSES,
  SELFIE_CAPTURE_TRANSITIONS,
  assertSelfieCaptureTransition,
  canTransitionSelfieCapture,
  selfieCaptureEventNameSchema,
  type SelfieCaptureStatus,
} from './selfie-capture-state-machine.js';

describe('the selfie capture vocabulary (C40.1)', () => {
  it('has four statuses, four error codes and one capture-method enum', () => {
    expect(SELFIE_CAPTURE_STATUSES).toEqual(['initiated', 'submitted', 'processed', 'errored']);
    expect(SELFIE_CAPTURE_ERROR_CODES).toEqual([
      'superseded',
      'expired',
      'canceled',
      'processing_failed',
    ]);
    expect(SELFIE_CAPTURE_METHODS).toEqual(['camera', 'upload']);
  });

  it('names one selfie.* event per status', () => {
    expect(SELFIE_CAPTURE_EVENT_BY_STATUS).toEqual({
      initiated: 'selfie.created',
      submitted: 'selfie.submitted',
      processed: 'selfie.processed',
      errored: 'selfie.errored',
    });
    expect(selfieCaptureEventNameSchema.options).toEqual([
      'selfie.created',
      'selfie.submitted',
      'selfie.processed',
      'selfie.errored',
    ]);
  });
});

describe('the selfie capture state machine (C40.1)', () => {
  it('declares exactly the C40.1 transitions', () => {
    expect(SELFIE_CAPTURE_TRANSITIONS).toEqual({
      initiated: ['submitted', 'errored'],
      submitted: ['processed', 'errored'],
      processed: [],
      errored: [],
    });
    expect(Object.isFrozen(SELFIE_CAPTURE_TRANSITIONS)).toBe(true);
  });

  it.each([
    ['initiated', 'submitted', true],
    ['initiated', 'errored', true],
    ['submitted', 'processed', true],
    ['submitted', 'errored', true],
    ['initiated', 'processed', false],
    ['processed', 'errored', false],
    ['errored', 'initiated', false],
    ['submitted', 'initiated', false],
    ['constructor', 'submitted', false],
  ] as const)('%s -> %s is allowed: %s', (from, to, allowed) => {
    expect(canTransitionSelfieCapture(from, to)).toBe(allowed);
  });

  it('returns the event of the target status', () => {
    expect(assertSelfieCaptureTransition('initiated', 'submitted')).toBe('selfie.submitted');
    expect(assertSelfieCaptureTransition('submitted', 'processed')).toBe('selfie.processed');
    expect(assertSelfieCaptureTransition('initiated', 'errored', 'superseded')).toBe(
      'selfie.errored',
    );
  });

  it.each(['superseded', 'expired', 'canceled'] as const)(
    'errors an initiated capture as %s',
    (code) => {
      expect(assertSelfieCaptureTransition('initiated', 'errored', code)).toBe('selfie.errored');
    },
  );

  it('errors a submitted capture only when processing failed', () => {
    expect(assertSelfieCaptureTransition('submitted', 'errored', 'processing_failed')).toBe(
      'selfie.errored',
    );
    expect(() => assertSelfieCaptureTransition('submitted', 'errored', 'superseded')).toThrow(
      InvalidSelfieCaptureTransitionError,
    );
    expect(() =>
      assertSelfieCaptureTransition('initiated', 'errored', 'processing_failed'),
    ).toThrow(InvalidSelfieCaptureTransitionError);
  });

  it('needs an error code to error, and refuses one otherwise', () => {
    expect(() => assertSelfieCaptureTransition('initiated', 'errored')).toThrow(
      InvalidSelfieCaptureTransitionError,
    );
    expect(() => assertSelfieCaptureTransition('initiated', 'submitted', 'expired')).toThrow(
      InvalidSelfieCaptureTransitionError,
    );
  });

  it('refuses a transition the table does not list, with a domain error code', () => {
    const attempt = (from: SelfieCaptureStatus, to: SelfieCaptureStatus) => () =>
      assertSelfieCaptureTransition(from, to);
    expect(attempt('processed', 'submitted')).toThrow(InvalidSelfieCaptureTransitionError);
    try {
      attempt('errored', 'submitted')();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_selfie_capture_transition',
        from: 'errored',
        to: 'submitted',
      });
    }
  });
});
