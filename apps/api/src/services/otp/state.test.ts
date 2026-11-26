/**
 * C52.2, C55.4-C55.6: the code the user last received, whether it can be entered, the cooldowns
 * after sends 1 to 4 on the application clock, the no-dead-end rule and `guidance.otp`.
 */
import type { OtpChallenge, OtpVerificationState } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import {
  deliveredChallenge,
  isUsableCode,
  otpGuidanceState,
  outOfCodes,
  resendAvailableAt,
} from './state.js';

const T0 = new Date('2026-10-23T09:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function challenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
  return {
    id: 'otpc_01M5CK3190XEVBM5ZXA76E1JSM',
    environmentId: 'env_state',
    verificationId: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
    inquiryId: 'inq_01M5CK3190XEVBM5ZXA76E1JSM',
    channel: 'sms',
    status: 'sent',
    failedAttempts: 0,
    codeKeyId: 'kek-1',
    provider: 'sandbox',
    providerMessageId: null,
    sentAt: T0,
    expiresAt: at(600),
    confirmedAt: null,
    errorCode: null,
    destinationIndex: 'f'.repeat(64),
    hasDestination: true,
    redactedAt: null,
    ...overrides,
  };
}

function state(overrides: Partial<OtpVerificationState> = {}): OtpVerificationState {
  return {
    environmentId: 'env_state',
    verificationId: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
    inquiryId: 'inq_01M5CK3190XEVBM5ZXA76E1JSM',
    sends: 1,
    wrongEntries: 0,
    limitedAt: null,
    limitedReason: null,
    updatedAt: T0,
    ...overrides,
  };
}

describe('deliveredChallenge', () => {
  it('is the newest code that reached the user', () => {
    const errored = challenge({ id: 'otpc_b', status: 'errored', sentAt: at(40) });
    const expired = challenge({ id: 'otpc_a', status: 'expired', sentAt: at(0) });

    expect(deliveredChallenge([errored, expired])?.id).toBe('otpc_a');
    expect(deliveredChallenge([challenge({ status: 'superseded' })])).toBeNull();
    expect(deliveredChallenge([])).toBeNull();
  });
});

describe('isUsableCode', () => {
  it('is an open code before its expiry with attempts left', () => {
    expect(isUsableCode(challenge(), at(599))).toBe(true);
    expect(isUsableCode(challenge(), at(600))).toBe(false);
    expect(isUsableCode(challenge({ failedAttempts: 5 }), at(10))).toBe(false);
    expect(isUsableCode(challenge({ status: 'exhausted' }), at(10))).toBe(false);
    expect(isUsableCode(challenge({ status: 'confirmed' }), at(10))).toBe(false);
    expect(isUsableCode(null, at(10))).toBe(false);
  });
});

describe('resendAvailableAt (C55.6)', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 240],
  ])('waits after send %i for %i seconds from the newest delivered send', (sends, seconds) => {
    const sent = challenge({ sentAt: at(10) });
    const failed = challenge({ status: 'errored', sentAt: at(20) });

    expect(resendAvailableAt([failed, sent], sends, at(15))).toEqual(at(10 + seconds));
  });

  it('allows none after the fifth send or once a code was confirmed, and one at once before any', () => {
    expect(resendAvailableAt([challenge()], 5, at(1))).toBeNull();
    expect(resendAvailableAt([challenge({ status: 'confirmed' })], 1, at(1))).toBeNull();
    expect(resendAvailableAt([], 0, at(3))).toEqual(at(3));
  });
});

describe('outOfCodes (C55.6, no dead end)', () => {
  it('holds once every send was used and no code can be entered', () => {
    const expired = challenge({ status: 'expired' });

    expect(outOfCodes([expired], state({ sends: 5 }), at(700))).toBe(true);
    expect(outOfCodes([challenge()], state({ sends: 5 }), at(700))).toBe(true);
    expect(outOfCodes([challenge()], state({ sends: 5 }), at(10))).toBe(false);
    expect(outOfCodes([expired], state({ sends: 4 }), at(700))).toBe(false);
    expect(outOfCodes([], null, at(700))).toBe(false);
  });
});

describe('otpGuidanceState (C52.2)', () => {
  it('describes the open code without the code', () => {
    const guidance = otpGuidanceState({
      challenges: [challenge({ failedAttempts: 2 })],
      state: state({ sends: 2 }),
      maskedDestination: '+1 ••• ••• 0100',
      now: at(5),
    });

    expect(guidance).toEqual({
      'masked-destination': '+1 ••• ••• 0100',
      'expires-at': at(600).toISOString(),
      'resend-available-at': at(60).toISOString(),
      'sends-remaining': 3,
      'attempts-remaining': 3,
    });
  });

  it('leaves no attempt on an expired or exhausted code and no send once confirmed', () => {
    const expired = otpGuidanceState({
      challenges: [challenge()],
      state: state(),
      maskedDestination: '+1 ••• ••• 0100',
      now: at(601),
    });
    const confirmed = otpGuidanceState({
      challenges: [challenge({ status: 'confirmed', confirmedAt: at(20) })],
      state: state(),
      maskedDestination: '+1 ••• ••• 0100',
      now: at(30),
    });

    expect(expired).toMatchObject({ 'attempts-remaining': 0, 'sends-remaining': 4 });
    expect(confirmed).toMatchObject({ 'attempts-remaining': 0, 'resend-available-at': null });
  });

  it('is null before a code reached the user or without its destination', () => {
    expect(
      otpGuidanceState({ challenges: [], state: null, maskedDestination: null, now: T0 }),
    ).toBeNull();
    expect(
      otpGuidanceState({
        challenges: [challenge({ status: 'errored' })],
        state: state({ sends: 0 }),
        maskedDestination: '+1 ••• ••• 0100',
        now: T0,
      }),
    ).toBeNull();
    expect(
      otpGuidanceState({
        challenges: [challenge()],
        state: state(),
        maskedDestination: null,
        now: T0,
      }),
    ).toBeNull();
  });
});
